import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

// Type definitions for FBOs
interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap: () => void;
}

interface PresetColors {
  tileColor: number[];
  groutColor: number[];
  waterColor: number[];
  lightColor: number[];
  lightDir: number[];
}

const PRESETS: Record<string, PresetColors> = {
  classic: {
    tileColor: [0.1, 0.35, 0.65],
    groutColor: [0.85, 0.95, 1.0],
    waterColor: [0.2, 0.7, 0.9],
    lightColor: [1.0, 1.0, 1.0],
    lightDir: [1.0, 1.5, 1.0],
  },
  neon: {
    tileColor: [0.15, 0.05, 0.3],
    groutColor: [1.0, 0.35, 0.85],  // neon pink
    waterColor: [0.1, 0.85, 1.0],  // cyan
    lightColor: [0.95, 0.5, 1.0],  // purple/magenta
    lightDir: [1.0, 1.2, 0.8],
  },
  lava: {
    tileColor: [0.25, 0.08, 0.05],
    groutColor: [1.0, 0.45, 0.15],  // hot orange
    waterColor: [1.0, 0.65, 0.1],  // orange glow
    lightColor: [1.0, 0.85, 0.3],  // fiery yellow
    lightDir: [-0.8, 1.5, -0.8],
  },
  toxic: {
    tileColor: [0.08, 0.22, 0.1],
    groutColor: [0.6, 1.0, 0.35],  // lime green
    waterColor: [0.35, 0.95, 0.55],  // toxic green
    lightColor: [0.75, 0.4, 1.0],  // neon violet
    lightDir: [0.5, 1.8, 0.5],
  },
};

// --- GLSL Shaders ---

const baseVertexShader = `#version 300 es
  in vec2 aPosition;
  out vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const waveUpdateShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uWater; // R: current height, G: previous height
  uniform vec2 uTexelSize;
  uniform float uDamping;
  void main() {
    float L = texture(uWater, vUv - vec2(uTexelSize.x, 0.0)).r;
    float R = texture(uWater, vUv + vec2(uTexelSize.x, 0.0)).r;
    float T = texture(uWater, vUv + vec2(0.0, uTexelSize.y)).r;
    float B = texture(uWater, vUv - vec2(0.0, uTexelSize.y)).r;

    float currentHeight = texture(uWater, vUv).r;
    float prevHeight = texture(uWater, vUv).g;

    // Wave equation solver
    float nextHeight = (L + R + T + B) * 0.5 - prevHeight;
    nextHeight *= uDamping;

    // Store next height in R, current height (now previous) in G
    fragColor = vec4(nextHeight, currentHeight, 0.0, 1.0);
  }
`;

const splatShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uWater;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uStrength;
  void main() {
    vec4 data = texture(uWater, vUv);
    float d = distance(vUv, uCenter);
    if (d < uRadius) {
      float factor = 1.0 - d / uRadius;
      data.r += factor * factor * factor * uStrength;
    }
    fragColor = data;
  }
`;

const renderShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform sampler2D uWater;
  uniform vec2 uResolution;
  uniform vec3 uCameraPos;
  uniform vec3 uCameraTarget;
  uniform float uAspect;
  
  // Custom Visual Style Params
  uniform vec3 uTileColor;
  uniform vec3 uGroutColor;
  uniform vec3 uWaterColor;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;

  // Interactive Elements
  uniform vec3 uSphereCenter;
  uniform float uSphereRadius;
  uniform float uShowSphere;

  // Gesture markers
  uniform vec2 uHand1;
  uniform vec2 uHand2;
  uniform vec2 uNose;

  // Ray sphere intersection
  float intersectSphere(vec3 ro, vec3 rd, vec3 center, float radius, out vec3 normal) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    
    h = sqrt(h);
    float t1 = -b - h;
    float t2 = -b + h;
    
    float t = -1.0;
    if (t1 > 0.0) t = t1;
    else if (t2 > 0.0) t = t2;
    
    if (t > 0.0) {
      normal = normalize((ro + t * rd) - center);
    }
    return t;
  }

  // Procedural floor tile rendering under the water
  vec3 getFloorColor(vec3 point, float waterHeightCurvature, float waveFade) {
    float scale = 6.0;
    vec2 uv = point.xz;
    vec2 grid = abs(fract(uv * scale - 0.5) - 0.5) / (2.0 * fwidth(uv * scale) + vec2(1e-5));
    float line = min(grid.x, grid.y);
    float c = 1.0 - min(line, 1.0);
    
    // Bright neon tiles
    vec3 baseColor = mix(uTileColor * 0.4, uGroutColor * 1.3, c * 0.45);
    
    // Ambient + diffuse light
    vec3 ambient = baseColor * 0.6;
    vec3 lit = baseColor * uLightColor * 0.6;
    vec3 finalColor = ambient + lit;
    
    // Apply dynamic caustics effect from curvature (faded in the distance to prevent aliasing)
    float caustic = waterHeightCurvature * 38.0 * waveFade;
    finalColor += uLightColor * max(0.0, caustic) * 0.95;
    
    // Light absorption depth tint (bright neon color tint)
    vec3 tintColor = exp(-vec3(1.2, 0.6, 0.1) * (vec3(1.0) - uWaterColor) * 0.8);
    finalColor *= tintColor;
    
    return finalColor;
  }

  // A much brighter sky representation
  vec3 getSkyColor(vec3 rd) {
    float t = rd.y * 0.5 + 0.5;
    // Ambient sky gradient matches the water preset colors beautifully
    vec3 sky = mix(uWaterColor * 0.15, uWaterColor * 0.75, t);
    float glow = pow(max(0.0, dot(rd, uLightDir)), 16.0);
    return sky + uLightColor * glow * 0.9;
  }

  // Camera ray setup helper
  vec3 getCameraRay(vec2 ndc) {
    vec3 forward = normalize(uCameraTarget - uCameraPos);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    
    float tanFOV = 0.45;
    return normalize(forward + ndc.x * right * uAspect * tanFOV + ndc.y * up * tanFOV);
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 ro = uCameraPos;
    vec3 rd = getCameraRay(ndc);
    
    vec3 finalColor = vec3(0.0);
    
    // Since there is no bounding pool box, the water plane is an infinite flat plane at y = 0.0
    // As long as camera is looking down (rd.y < 0), we will always hit the water plane.
    float t_water = -ro.y / (rd.y - 1e-6);
    vec3 p_water = ro + t_water * rd;
    
    // Map water coordinates to heightfield texture coords (centered at [0, 0], expanded to [-3.0, 3.0])
    vec2 waterUV = clamp(p_water.xz * (1.0 / 6.0) + 0.5, 0.0, 1.0);
    
    // Check if the camera ray hits the floating sphere directly (above water)
    vec3 n_sphere;
    float t_sphere = -1.0;
    if (uShowSphere > 0.5) {
      t_sphere = intersectSphere(ro, rd, uSphereCenter, uSphereRadius, n_sphere);
    }
    
    if (t_sphere > 0.0 && t_sphere < t_water) {
      // Shade sphere above water
      vec3 hitPt = ro + t_sphere * rd;
      float diffuse = max(0.0, dot(n_sphere, uLightDir));
      vec3 halfDir = normalize(uLightDir + (-rd));
      float spec = pow(max(0.0, dot(n_sphere, halfDir)), 64.0) * 1.5;
      
      vec3 sphereBaseColor = mix(uTileColor * 0.5, vec3(0.9, 0.9, 0.9), 0.15);
      finalColor = sphereBaseColor * (0.35 + 0.65 * diffuse) + uLightColor * spec * 0.6;
      fragColor = vec4(finalColor, 1.0);
      return;
    }
    
    if (t_water > 0.0) {
      // Water heightfield sampling & normal estimation
      vec2 texel = vec2(1.0) / vec2(textureSize(uWater, 0));
      float h = texture(uWater, waterUV).r;
      float hL = texture(uWater, waterUV - vec2(texel.x, 0.0)).r;
      float hR = texture(uWater, waterUV + vec2(texel.x, 0.0)).r;
      float hT = texture(uWater, waterUV + vec2(0.0, texel.y)).r;
      float hB = texture(uWater, waterUV - vec2(0.0, texel.y)).r;
      
      // Laplacian curvature
      float curvature = (hL + hR + hT + hB - 4.0 * h);
      
      // Compute normal vector based on height difference
      float strength = 45.0; // amplify wave normal distortion
      
      // Fade out waves in the distance to prevent perspective aliasing / Moiré patterns near the horizon
      float waveFade = clamp((p_water.z + 2.2) / 1.7, 0.0, 1.0);
      float finalStrength = strength * waveFade;
      vec3 N = normalize(vec3((hL - hR) * finalStrength, 1.0, (hB - hT) * finalStrength));
      
      // Reflection and refraction vectors
      vec3 reflected = reflect(rd, N);
      vec3 refracted = refract(rd, N, 1.0 / 1.333); // water refraction index ~ 1.333
      
      // Schlick's approximation for Fresnel reflection
      float R0 = 0.02;
      float fresnel = R0 + (1.0 - R0) * pow(1.0 - max(0.0, dot(-rd, N)), 5.0);
      
      // Trace refracted ray to intersect the infinite floor at y = -0.5
      float t_floor = -0.5 / (refracted.y - 1e-6);
      vec3 p_floor = p_water + t_floor * refracted;
      
      // Check if refracted ray hits the sphere underwater
      vec3 n_sphere_under;
      float t_sphere_under = -1.0;
      if (uShowSphere > 0.5) {
        t_sphere_under = intersectSphere(p_water, refracted, uSphereCenter, uSphereRadius, n_sphere_under);
      }
      
      vec3 refractColor;
      if (t_sphere_under > 0.0 && t_sphere_under < t_floor) {
        // Shade sphere underwater
        vec3 p_sphere = p_water + t_sphere_under * refracted;
        float diffuse = max(0.0, dot(n_sphere_under, uLightDir));
        vec3 halfDir = normalize(uLightDir + (-refracted));
        float spec = pow(max(0.0, dot(n_sphere_under, halfDir)), 64.0) * 1.5;
        
        vec3 sphereBaseColor = mix(uTileColor * 0.5, vec3(0.9, 0.9, 0.9), 0.15);
        refractColor = sphereBaseColor * (0.35 + 0.65 * diffuse) + uLightColor * spec * 0.6;
        
        // Depth absorption tint for underwater sphere
        float sphereDepth = -p_sphere.y;
        refractColor *= exp(-vec3(1.2, 0.6, 0.1) * (vec3(1.0) - uWaterColor) * sphereDepth * 1.5);
      } else {
        refractColor = getFloorColor(p_floor, curvature, waveFade);
      }
      
      vec3 reflectColor = getSkyColor(reflected);
      
      // Combine refraction & reflection with Fresnel
      finalColor = mix(refractColor, reflectColor, fresnel);
      
      // Highlight interactive gestures (glowing hand points overlay)
      float d1 = distance(p_water.xz, uHand1);
      float d2 = distance(p_water.xz, uHand2);
      float dNose = distance(p_water.xz, uNose);
      
      if (d1 < 0.065) {
        finalColor += vec3(0.0, 0.8, 1.0) * (1.0 - d1 / 0.065) * 0.45;
      }
      if (d2 < 0.065) {
        finalColor += vec3(1.0, 0.0, 0.7) * (1.0 - d2 / 0.065) * 0.45;
      }
      if (dNose < 0.05) {
        finalColor += vec3(0.8, 0.8, 0.0) * (1.0 - dNose / 0.05) * 0.3;
      }
      
      // Add specular water shimmer (sun highlight)
      float waterSpec = pow(max(0.0, dot(reflected, uLightDir)), 80.0) * 2.2;
      finalColor += uLightColor * waterSpec;
      
    } else {
      finalColor = getSkyColor(rd);
    }
    
    fragColor = vec4(finalColor, 1.0);
  }
`;

export function WaterSimulator() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Custom states
  const [visualPreset, setVisualPreset] = useState<'classic' | 'neon' | 'lava' | 'toxic'>('neon');
  const [damping, setDamping] = useState(0.98);
  const [splatRadius, setSplatRadius] = useState(0.03);
  const [splatStrength, setSplatStrength] = useState(2.0);
  const [useCamera, setUseCamera] = useState(true);
  const [showQACard, setShowQACard] = useState(true);
  const [showSphere, setShowSphere] = useState(true);

  // App Zustand values
  const setStage = useAppStore((s) => s.setStage);
  const poseLandmarks = useAppStore((s) => s.poseLandmarks);
  const poseLandmarksRef = useRef<number[][] | null>(null);
  const prevPoseLandmarksRef = useRef<Record<number, { x: number; z: number }>>({});

  // Interaction sphere position
  const sphereCenterRef = useRef<[number, number, number]>([0.0, -0.05, 0.0]);
  const prevSphereCenterRef = useRef<[number, number, number]>([0.0, -0.05, 0.0]);
  const isDraggingSphereRef = useRef(false);

  // Track coordinates for gesture markers in WebGL
  const gestureCoordsRef = useRef<{ hand1: [number, number]; hand2: [number, number]; nose: [number, number] }>({
    hand1: [-10.0, -10.0],
    hand2: [-10.0, -10.0],
    nose: [-10.0, -10.0],
  });

  // Track configuration refs to avoid shader reinitialization on state updates
  const configRef = useRef({
    visualPreset,
    damping,
    splatRadius,
    splatStrength,
    useCamera,
    showSphere,
  });

  useEffect(() => {
    configRef.current = {
      visualPreset,
      damping,
      splatRadius,
      splatStrength,
      useCamera,
      showSphere,
    };
  }, [visualPreset, damping, splatRadius, splatStrength, useCamera, showSphere]);

  useEffect(() => {
    poseLandmarksRef.current = poseLandmarks;
  }, [poseLandmarks]);

  // JS Raycast Helper
  const getWaterCoordinate = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const my = -(((clientY - rect.top) / rect.height) * 2 - 1); // WebGL starts bottom-left
    const aspect = rect.width / rect.height;

    // Fixed Camera Parameters matching shader
    const cy = 1.2;
    const cameraPos = [0.0, cy, 2.0];
    const cameraTarget = [0.0, -0.15, 0.0];

    // Compute Ray Direction
    const f = [cameraTarget[0] - cameraPos[0], cameraTarget[1] - cameraPos[1], cameraTarget[2] - cameraPos[2]];
    const fLen = Math.hypot(f[0], f[1], f[2]);
    const forward = [f[0] / fLen, f[1] / fLen, f[2] / fLen];

    const right = [1.0, 0.0, 0.0]; // simplified since camera is strictly looking forward-down
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0]
    ];

    const tanFOV = 0.45;
    const rd = [
      forward[0] + mx * right[0] * aspect * tanFOV + my * up[0] * tanFOV,
      forward[1] + mx * right[1] * aspect * tanFOV + my * up[1] * tanFOV,
      forward[2] + mx * right[2] * aspect * tanFOV + my * up[2] * tanFOV
    ];
    const rdLen = Math.hypot(rd[0], rd[1], rd[2]);
    const rdNorm = [rd[0] / rdLen, rd[1] / rdLen, rd[2] / rdLen];

    if (rdNorm[1] >= 0) return null; // pointing upwards or flat

    const t = -cameraPos[1] / rdNorm[1];
    const x = cameraPos[0] + t * rdNorm[0];
    const z = cameraPos[2] + t * rdNorm[2];

    return { x, z, t };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.error("WebGL 2 context not available.");
      return;
    }

    // Floating point format checks
    const extFloat = gl.getExtension('EXT_color_buffer_float');
    const extLinear = gl.getExtension('OES_texture_float_linear');

    const internalFormat = extFloat ? gl.RGBA16F : gl.RGBA8;
    const format = gl.RGBA;
    const textureDataType = extFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const filterMode = (extLinear || !extFloat) ? gl.LINEAR : gl.NEAREST;

    // Simulation resolution
    const simSize = 256;
    let width = 0;
    let height = 0;

    let waterFBO: DoubleFBO;

    // Shader Compile Helpers
    const createShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compiler error: ", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const createProgram = (vsSource: string, fsSource: string): WebGLProgram | null => {
      const vs = createShader(gl.VERTEX_SHADER, vsSource);
      const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return null;

      const program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program link error: ", gl.getProgramInfoLog(program));
        return null;
      }
      return program;
    };

    // Compile programs
    const updateProgram = createProgram(baseVertexShader, waveUpdateShader)!;
    const splatProgram = createProgram(baseVertexShader, splatShader)!;
    const renderProgram = createProgram(baseVertexShader, renderShader)!;

    // Uniform Caches
    const updateUniforms: Record<string, WebGLUniformLocation> = {
      uWater: gl.getUniformLocation(updateProgram, 'uWater')!,
      uTexelSize: gl.getUniformLocation(updateProgram, 'uTexelSize')!,
      uDamping: gl.getUniformLocation(updateProgram, 'uDamping')!,
    };

    const splatUniforms: Record<string, WebGLUniformLocation> = {
      uWater: gl.getUniformLocation(splatProgram, 'uWater')!,
      uCenter: gl.getUniformLocation(splatProgram, 'uCenter')!,
      uRadius: gl.getUniformLocation(splatProgram, 'uRadius')!,
      uStrength: gl.getUniformLocation(splatProgram, 'uStrength')!,
    };

    const renderUniforms: Record<string, WebGLUniformLocation> = {
      uWater: gl.getUniformLocation(renderProgram, 'uWater')!,
      uResolution: gl.getUniformLocation(renderProgram, 'uResolution')!,
      uCameraPos: gl.getUniformLocation(renderProgram, 'uCameraPos')!,
      uCameraTarget: gl.getUniformLocation(renderProgram, 'uCameraTarget')!,
      uAspect: gl.getUniformLocation(renderProgram, 'uAspect')!,
      uTileColor: gl.getUniformLocation(renderProgram, 'uTileColor')!,
      uGroutColor: gl.getUniformLocation(renderProgram, 'uGroutColor')!,
      uWaterColor: gl.getUniformLocation(renderProgram, 'uWaterColor')!,
      uLightDir: gl.getUniformLocation(renderProgram, 'uLightDir')!,
      uLightColor: gl.getUniformLocation(renderProgram, 'uLightColor')!,
      uSphereCenter: gl.getUniformLocation(renderProgram, 'uSphereCenter')!,
      uSphereRadius: gl.getUniformLocation(renderProgram, 'uSphereRadius')!,
      uShowSphere: gl.getUniformLocation(renderProgram, 'uShowSphere')!,
      uHand1: gl.getUniformLocation(renderProgram, 'uHand1')!,
      uHand2: gl.getUniformLocation(renderProgram, 'uHand2')!,
      uNose: gl.getUniformLocation(renderProgram, 'uNose')!,
    };

    // Full screen quad mesh
    const positionAttributeLocation = gl.getAttribLocation(renderProgram, 'aPosition');
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), gl.STATIC_DRAW);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // FBO Creation Helper
    const createFBO = (w: number, h: number): FBO => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, textureDataType, null);

      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      gl.viewport(0, 0, w, h);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      return { texture, fbo, width: w, height: h };
    };

    const createDoubleFBO = (w: number, h: number): DoubleFBO => {
      let f1 = createFBO(w, h);
      let f2 = createFBO(w, h);
      return {
        get read() { return f1; },
        get write() { return f2; },
        swap() {
          const temp = f1;
          f1 = f2;
          f2 = temp;
        }
      };
    };

    waterFBO = createDoubleFBO(simSize, simSize);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (width === w && height === h) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    };

    resize();

    // Splash ripple helper
    const injectSplat = (x: number, z: number, strength: number, radius: number) => {
      // Map [-3, 3] spatial coords to [0, 1] uv coordinates
      const u = x * (1.0 / 6.0) + 0.5;
      const v = z * (1.0 / 6.0) + 0.5;

      gl.viewport(0, 0, simSize, simSize);
      gl.useProgram(splatProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, waterFBO.write.fbo);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, waterFBO.read.texture);
      gl.uniform1i(splatUniforms.uWater, 0);

      gl.uniform2f(splatUniforms.uCenter, u, v);
      gl.uniform1f(splatUniforms.uRadius, radius);
      gl.uniform1f(splatUniforms.uStrength, strength);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      waterFBO.swap();
    };

    let lastSplatTime = 0;

    const update = () => {
      resize();
      const time = performance.now() / 1000.0;
      const config = configRef.current;

      gl.bindVertexArray(vao);

      // --- 0. Drain manual splats queue ---
      const q = (gl as any).manualSplatsRef?.current;
      if (q && q.length > 0) {
        while (q.length > 0) {
          const s = q.shift();
          if (s) injectSplat(s.x, s.z, s.strength, s.radius);
        }
      }

      // --- 1. Wave Physics Solver step ---
      gl.viewport(0, 0, simSize, simSize);
      gl.useProgram(updateProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, waterFBO.write.fbo);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, waterFBO.read.texture);
      gl.uniform1i(updateUniforms.uWater, 0);
      gl.uniform2f(updateUniforms.uTexelSize, 1.0 / simSize, 1.0 / simSize);
      gl.uniform1f(updateUniforms.uDamping, config.damping);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      waterFBO.swap();

      // --- 2. Ambient ripple / Bobbing sphere ---
      if (config.showSphere) {
        // Floating bobbing motion for the sphere
        const currentY = -0.05 + Math.sin(time * 3.5) * 0.015;
        sphereCenterRef.current[1] = currentY;

        // If sphere is floating or dragged, create light waves at XZ
        const sx = sphereCenterRef.current[0];
        const sz = sphereCenterRef.current[2];
        const prevSx = prevSphereCenterRef.current[0];
        const prevSz = prevSphereCenterRef.current[2];
        const distMoved = Math.hypot(sx - prevSx, sz - prevSz);

        if (distMoved > 0.005) {
          // Splat based on drag velocity
          injectSplat(sx, sz, distMoved * 5.0, config.splatRadius * 1.5);
        } else {
          // Bobbing generates tiny concentric waves
          if (Math.abs(Math.sin(time * 3.5)) > 0.98 && performance.now() - lastSplatTime > 150) {
            injectSplat(sx, sz, 0.02, config.splatRadius * 0.8);
            lastSplatTime = performance.now();
          }
        }

        prevSphereCenterRef.current = [...sphereCenterRef.current] as [number, number, number];
      }

      // --- 3. CV Camera Pose interaction ---
      const coords = gestureCoordsRef.current;
      coords.hand1 = [-10.0, -10.0];
      coords.hand2 = [-10.0, -10.0];
      coords.nose = [-10.0, -10.0];

      if (config.useCamera && poseLandmarksRef.current) {
        const landmarks = poseLandmarksRef.current;

        // Wrist tracking
        const trackJoint = (idx: number, isRight: boolean) => {
          if (idx < landmarks.length) {
            const pt = landmarks[idx];
            if (pt && !isNaN(pt[0]) && !isNaN(pt[1])) {
              // Map mediaPipe [0, 1] mirrored coordinates to webgl spatial coords (expanded to cover visible plane)
              const x = (1.0 - pt[0]) * 5.0 - 2.5;
              const z = pt[1] * 3.0 - 2.0;

              if (isRight) coords.hand2 = [x, z];
              else coords.hand1 = [x, z];

              const prev = prevPoseLandmarksRef.current[idx];
              if (prev) {
                const dx = x - prev.x;
                const dz = z - prev.z;
                const speed = Math.hypot(dx, dz);
                if (speed > 0.015) {
                  const strength = Math.min(3.0, speed * 25.0 * config.splatStrength);
                  injectSplat(x, z, strength, config.splatRadius * 1.6);
                }
              }
              prevPoseLandmarksRef.current[idx] = { x, z };
            }
          }
        };

        // Nose tracking (soft drift ripples)
        if (landmarks[0]) {
          const nosePt = landmarks[0];
          if (nosePt && !isNaN(nosePt[0]) && !isNaN(nosePt[1])) {
            const nx = (1.0 - nosePt[0]) * 5.0 - 2.5;
            const nz = nosePt[1] * 3.0 - 2.0;
            coords.nose = [nx, nz];

            // Soft ripple occasionally
            if (Math.random() < 0.05) {
              injectSplat(nx, nz, 0.02, config.splatRadius * 1.0);
            }
          }
        }

        trackJoint(15, false); // Left wrist
        trackJoint(16, true);  // Right wrist
      }

      // --- 4. Main 3D raytracing render to screen ---
      gl.viewport(0, 0, width, height);
      gl.useProgram(renderProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Render to canvas backbuffer

      // Bind heightmap texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, waterFBO.read.texture);
      gl.uniform1i(renderUniforms.uWater, 0);

      // Render uniforms
      gl.uniform2f(renderUniforms.uResolution, width, height);
      gl.uniform3f(renderUniforms.uCameraPos, 0.0, 1.2, 2.0);
      gl.uniform3f(renderUniforms.uCameraTarget, 0.0, -0.15, 0.0);
      gl.uniform1f(renderUniforms.uAspect, width / height);

      // Styles matching preset
      const preset = PRESETS[config.visualPreset] || PRESETS.neon;
      gl.uniform3fv(renderUniforms.uTileColor, new Float32Array(preset.tileColor));
      gl.uniform3fv(renderUniforms.uGroutColor, new Float32Array(preset.groutColor));
      gl.uniform3fv(renderUniforms.uWaterColor, new Float32Array(preset.waterColor));
      gl.uniform3fv(renderUniforms.uLightColor, new Float32Array(preset.lightColor));

      const lightDirNorm = [...preset.lightDir];
      const ldLen = Math.hypot(lightDirNorm[0], lightDirNorm[1], lightDirNorm[2]);
      gl.uniform3f(renderUniforms.uLightDir, lightDirNorm[0] / ldLen, lightDirNorm[1] / ldLen, lightDirNorm[2] / ldLen);

      // Interactive sphere
      gl.uniform3fv(renderUniforms.uSphereCenter, new Float32Array(sphereCenterRef.current));
      gl.uniform1f(renderUniforms.uSphereRadius, 0.15); // R=0.15
      gl.uniform1f(renderUniforms.uShowSphere, config.showSphere ? 1.0 : 0.0);

      // Gesture Uniforms
      gl.uniform2f(renderUniforms.uHand1, coords.hand1[0], coords.hand1[1]);
      gl.uniform2f(renderUniforms.uHand2, coords.hand2[0], coords.hand2[1]);
      gl.uniform2f(renderUniforms.uNose, coords.nose[0], coords.nose[1]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationFrameIdRef.current = requestAnimationFrame(update);
    };

    update();

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }

      // Cleanup
      gl.deleteBuffer(quadBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(updateProgram);
      gl.deleteProgram(splatProgram);
      gl.deleteProgram(renderProgram);

      const deleteFBO = (f: FBO) => {
        gl.deleteTexture(f.texture);
        gl.deleteFramebuffer(f.fbo);
      };
      deleteFBO(waterFBO.read);
      deleteFBO(waterFBO.write);
    };
  }, []);

  // --- Input Events ---

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coord = getWaterCoordinate(e.clientX, e.clientY, canvas);
    if (!coord) return;

    const config = configRef.current;

    if (config.showSphere) {
      const sx = sphereCenterRef.current[0];
      const sz = sphereCenterRef.current[2];
      const dist = Math.hypot(coord.x - sx, coord.z - sz);

      if (dist < 0.22) { // 0.22 grab radius
        isDraggingSphereRef.current = true;
        return;
      }
    }

    // Ripple splash on click
    injectManualSplat(coord.x, coord.z);
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coord = getWaterCoordinate(e.clientX, e.clientY, canvas);
    if (!coord) return;

    if (isDraggingSphereRef.current) {
      sphereCenterRef.current[0] = Math.max(-2.5, Math.min(2.5, coord.x));
      sphereCenterRef.current[2] = Math.max(-2.0, Math.min(1.0, coord.z));
      return;
    }

    if (e.buttons === 1) {
      injectManualSplat(coord.x, coord.z);
    }
  };

  const handlePointerUp = () => {
    isDraggingSphereRef.current = false;
  };

  const injectManualSplat = (x: number, z: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Call injectSplat on WebGL context by retrieving it from canvas
    const gl = canvas.getContext('webgl2');
    if (!gl) return;

    // Triggering via simulated click. Since simulation update loop is running, we can trigger splats
    // by sharing splat coordinate in refs or directly using canvas click ripple helper.
    // In our WebGL loop, we can store manual splats queue. Let's do it simply by checking a ref array
    manualSplatsRef.current.push({ x, z, strength: splatStrength, radius: splatRadius });
  };

  const manualSplatsRef = useRef<Array<{ x: number; z: number; strength: number; radius: number }>>([]);


  // Update FBO drawing to inject manual splats in the animation loop directly
  // We can modify the main update callback to read manualSplatsRef queue!
  // Let's modify the useEffect update function so that it pops and calls injectSplat on the fly:
  // "if (manualSplatsRef.current.length > 0) {
  //    const splat = manualSplatsRef.current.shift();
  //    if (splat) injectSplat(splat.x, splat.z, splat.strength, splat.radius);
  //  }"
  // This is highly performant and syncs perfectly!

  // Let's copy this injection logic to the GL update frame check:
  // (We'll capture manualSplatsRef inside GL loop)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2');
    if (!gl) return;

    // Attach to window or reference so the inner loop can read it:
    (gl as any).manualSplatsRef = manualSplatsRef;
  }, []);

  // In the update loop inside useEffect:
  // We can read:
  // const manualQueueRef = (gl as any).manualSplatsRef;
  // if (manualQueueRef && manualQueueRef.current.length > 0) {
  //   while (manualQueueRef.current.length > 0) {
  //     const s = manualQueueRef.current.shift();
  //     if (s) injectSplat(s.x, s.z, s.strength, s.radius);
  //   }
  // }
  // Let's rewrite the render loop initialization inside the useEffect to support this!
  // Wait! In the WebGL 2 useEffect code written above:
  // Let's view where we compile render/update steps.
  // We will edit the update loop inside WebGL 2 useEffect to draw manual splats.
  // Let's check how the update loop was set up in the WebGL code:
  // Yes! The queue draining can be placed inside the update loop before the wave solver or advection.
  // Let's put it right at the beginning of the `update()` loop:
  // ```typescript
  // // --- 0. Manual splats ---
  // const queue = (gl as any).manualSplatsRef?.current;
  // if (queue && queue.length > 0) {
  //   while (queue.length > 0) {
  //     const s = queue.shift();
  //     if (s) injectSplat(s.x, s.z, s.strength, s.radius);
  //   }
  // }
  // ```
  // That is absolutely perfect!

  // Let's write the complete file contents to `WaterSimulator.tsx` using overwrite.
  // Wait, let's verify if the update loop inside my code above has this injection.
  // Oh, my code above has:
  // ```typescript
  //     const update = () => {
  //       resize();
  //       const time = performance.now() / 1000.0;
  //       const config = configRef.current;
  //
  //       gl.bindVertexArray(vao);
  //
  //       // Drain manual splats queue
  //       const q = (gl as any).manualSplatsRef?.current;
  //       if (q && q.length > 0) {
  //         while (q.length > 0) {
  //           const s = q.shift();
  //           if (s) injectSplat(s.x, s.z, s.strength, s.radius);
  //         }
  //       }
  // ```
  // Wait, I should make sure it is in the `CodeContent` of `write_to_file`. Yes, I will write the complete file with the `manualSplatsRef` integration in the update loop!

  return (
    <div className="water-demo-container">
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* Mock Q&A Card Overlay for readability test */}
      {showQACard && (
        <div className="mock-qa-overlay">
          <div className="mock-qa-header">
            <span className="mock-qa-badge">第 3 题 / 共 6 题</span>
            <button className="mock-qa-sound" type="button">
              🔊 朗读中...
            </button>
          </div>
          <h2 className="mock-qa-text">
            深夜emo时，你的灵魂通常会漂向哪个终极归宿？
          </h2>
          <div className="mock-qa-options">
            <button className="mock-qa-option-btn" type="button">
              <span className="mock-qa-option-hint">← 举起左臂选择</span>
              <span className="mock-qa-option-label">🧘 “电子木鱼敲到冒烟”</span>
            </button>
            <button className="mock-qa-option-btn" type="button">
              <span className="mock-qa-option-hint">举起右臂选择 →</span>
              <span className="mock-qa-option-label">🍾 “接着奏乐接着舞”</span>
            </button>
          </div>
        </div>
      )}

      {/* Controls Panel */}
      <div className="water-controls-panel">
        <h3 className="water-title">3D手势交互水模拟沙盒</h3>

        {/* Preset Selection */}
        <div className="water-section">
          <h4 className="water-section-title">视觉预设</h4>
          <div className="water-presets-grid">
            <button
              className={`btn-water-preset ${visualPreset === 'classic' ? 'btn-water-preset--active' : ''}`}
              onClick={() => setVisualPreset('classic')}
            >
              🌊 经典泳池
            </button>
            <button
              className={`btn-water-preset ${visualPreset === 'neon' ? 'btn-water-preset--active' : ''}`}
              onClick={() => setVisualPreset('neon')}
            >
              🔮 霓虹幻境
            </button>
            <button
              className={`btn-water-preset ${visualPreset === 'lava' ? 'btn-water-preset--active' : ''}`}
              onClick={() => setVisualPreset('lava')}
            >
              🌋 熔岩炼狱
            </button>
            <button
              className={`btn-water-preset ${visualPreset === 'toxic' ? 'btn-water-preset--active' : ''}`}
              onClick={() => setVisualPreset('toxic')}
            >
              ☣️ 荧光毒沼
            </button>
          </div>
        </div>

        {/* Sliders */}
        <div className="water-section">
          <h4 className="water-section-title">物理模拟参数</h4>

          <div className="water-slider-group">
            <div className="water-slider-label">
              <span>波纹阻尼 ( Damping )</span>
              <span>{(damping * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.95"
              max="0.998"
              step="0.001"
              value={damping}
              onChange={(e) => setDamping(Number(e.target.value))}
              className="water-slider"
            />
          </div>

          <div className="water-slider-group">
            <div className="water-slider-label">
              <span>涟漪半径 ( Splat Radius )</span>
              <span>{(splatRadius * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.01"
              max="0.08"
              step="0.005"
              value={splatRadius}
              onChange={(e) => setSplatRadius(Number(e.target.value))}
              className="water-slider"
            />
          </div>

          <div className="water-slider-group">
            <div className="water-slider-label">
              <span>波纹力度 ( Splat Strength )</span>
              <span>{splatStrength.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="4.0"
              step="0.1"
              value={splatStrength}
              onChange={(e) => setSplatStrength(Number(e.target.value))}
              className="water-slider"
            />
          </div>
        </div>

        {/* Interaction options */}
        <div className="water-section">
          <h4 className="water-section-title">功能开关</h4>

          <label className="water-checkbox-label">
            <input
              type="checkbox"
              checked={useCamera}
              onChange={(e) => setUseCamera(e.target.checked)}
              className="water-checkbox"
            />
            摄像头手势互动 ( wrists & nose )
          </label>

          <label className="water-checkbox-label">
            <input
              type="checkbox"
              checked={showSphere}
              onChange={(e) => setShowSphere(e.target.checked)}
              className="water-checkbox"
            />
            浮力交互球 ( drag & float )
          </label>

          <label className="water-checkbox-label">
            <input
              type="checkbox"
              checked={showQACard}
              onChange={(e) => setShowQACard(e.target.checked)}
              className="water-checkbox"
            />
            叠加答题卡 ( Text Readability Test )
          </label>
        </div>

        {/* Exit Button */}
        <button
          className="btn-water-exit"
          onClick={() => setStage('STANDBY')}
        >
          🔙 返回待机控制台
        </button>
      </div>

      <div style={{
        position: 'absolute',
        bottom: '240px',
        right: '24px',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: 'rgba(0, 204, 255, 0.6)',
        textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
        zIndex: 10,
        pointerEvents: 'none',
        textAlign: 'right'
      }}>
        <div>操作指南:</div>
        <div>1. 鼠标点击拖拽水面激起波纹</div>
        <div>2. 拖拽浮球在水池内滑动</div>
        <div>3. 挥手激起七彩水浪涟漪</div>
      </div>
    </div>
  );
}
