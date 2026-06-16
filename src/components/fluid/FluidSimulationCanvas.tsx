import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';

// Type definitions for WebGL Fluid Solver structures
interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap: () => void;
}

export type FluidColorPalette = "Neon Wave" | "Solar Flares" | "Emerald Abyss" | "Monochrome Ink" | "Vibrant Rainbow";

export interface FluidConfig {
  vorticity: number;          // Curl strength (0 - 50)
  dyeDissipation: number;     // Dye fade rate (0.9 - 0.999)
  velocityDissipation: number;// Velocity decay rate (0.9 - 0.995)
  splatRadius: number;        // Splat size (0.0005 - 0.01)
  pressureIterations: number; // Jacobi solver iterations (5 - 40)
  colorPalette: FluidColorPalette;
  shadingActive: boolean;     // Enable pseudo-3D gloss/reflection
  useCVInteraction: boolean;  // Listen to poseLandmarks from MediaPipe
  splatForce: number;         // Splat velocity intensity (0.5 - 5.0)
}

const COLOR_PALETTES: Record<FluidColorPalette, number[][]> = {
  "Neon Wave": [
    [0.9, 0.05, 0.6],  // Hot pink
    [0.05, 0.9, 0.9],  // Cyan
    [0.7, 0.1, 0.9],  // Purple
    [0.9, 0.6, 0.05],  // Orange
  ],
  "Solar Flares": [
    [0.95, 0.2, 0.05], // Red-orange
    [0.9, 0.6, 0.05],  // Orange
    [0.95, 0.85, 0.1], // Yellow
    [0.8, 0.1, 0.2],   // Deep red
  ],
  "Emerald Abyss": [
    [0.05, 0.85, 0.3], // Bright green
    [0.05, 0.6, 0.9],  // Sky blue
    [0.1, 0.9, 0.6],   // Teal
    [0.02, 0.3, 0.15], // Deep forest green
  ],
  "Monochrome Ink": [
    [0.95, 0.95, 0.95], // Pure white
    [0.7, 0.75, 0.8],   // Slate blue/grey
    [0.3, 0.35, 0.4],   // Dark slate
    [0.5, 0.5, 0.5],     // Neutral grey
  ],
  "Vibrant Rainbow": [
    [0.9, 0.1, 0.1],   // Red
    [0.1, 0.9, 0.1],   // Green
    [0.1, 0.1, 0.9],   // Blue
    [0.9, 0.9, 0.1],   // Yellow
    [0.9, 0.1, 0.9],   // Magenta
    [0.1, 0.9, 0.9],   // Cyan
  ],
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

const clearShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTarget;
  uniform float uFactor;
  void main() {
    fragColor = uFactor * texture(uTarget, vUv);
  }
`;

const splatShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTarget;
  uniform float uAspectRatio;
  uniform vec2 uPoint;
  uniform vec3 uColor;
  uniform float uRadius;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspectRatio;
    float splat = exp(-dot(p, p) / uRadius);
    vec4 base = texture(uTarget, vUv);
    fragColor = base + vec4(uColor, 1.0) * splat;
  }
`;

const advectionShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 uTexelSize;
  uniform float uDt;
  uniform float uDissipation;
  void main() {
    vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexelSize;
    fragColor = texture(uSource, coord) / (1.0 + uDissipation * uDt);
  }
`;

const divergenceShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
    float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;

    if (vUv.x - uTexelSize.x < 0.0) L = -texture(uVelocity, vUv).x;
    if (vUv.x + uTexelSize.x > 1.0) R = -texture(uVelocity, vUv).x;
    if (vUv.y - uTexelSize.y < 0.0) B = -texture(uVelocity, vUv).y;
    if (vUv.y + uTexelSize.y > 1.0) T = -texture(uVelocity, vUv).y;

    float div = 0.5 * (R - L + T - B);
    fragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const curlShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
    float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
    float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
    float vorticity = 0.5 * (R - L - T + B);
    fragColor = vec4(vorticity, 0.0, 0.0, 1.0);
  }
`;

const vorticityShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexelSize;
  uniform float uCurlScale;
  uniform float uDt;
  void main() {
    float L = texture(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
    float C = texture(uCurl, vUv).x;

    vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
    force = force / (length(force) + 0.0001);
    force *= uCurlScale * C * vec2(1.0, -1.0);

    vec2 vel = texture(uVelocity, vUv).xy;
    fragColor = vec4(vel + force * uDt, 0.0, 1.0);
  }
`;

const pressureShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float div = texture(uDivergence, vUv).x;

    float C = texture(uPressure, vUv).x;
    if (vUv.x - uTexelSize.x < 0.0) L = C;
    if (vUv.x + uTexelSize.x > 1.0) R = C;
    if (vUv.y - uTexelSize.y < 0.0) B = C;
    if (vUv.y + uTexelSize.y > 1.0) T = C;

    float p = 0.25 * (L + R + B + T - div);
    fragColor = vec4(p, 0.0, 0.0, 1.0);
  }
`;

const gradientSubtractShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    vec2 vel = texture(uVelocity, vUv).xy;

    fragColor = vec4(vel - 0.5 * vec2(R - L, T - B), 0.0, 1.0);
  }
`;

const displayShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uDye;
  uniform sampler2D uBloom;
  uniform vec2 uTexelSize;
  uniform vec3 uBgColor;
  uniform float uShading;
  uniform float uBloomIntensity;
  void main() {
    vec3 color = texture(uDye, vUv).rgb;

    if (uShading > 0.0) {
      // Shading based on color gradient (pseudo-3D specular glass liquid effect)
      float L = texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).r + texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).g + texture(uDye, vUv - vec2(uTexelSize.x, 0.0)).b;
      float R = texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).r + texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).g + texture(uDye, vUv + vec2(uTexelSize.x, 0.0)).b;
      float B = texture(uDye, vUv - vec2(0.0, uTexelSize.y)).r + texture(uDye, vUv - vec2(0.0, uTexelSize.y)).g + texture(uDye, vUv - vec2(0.0, uTexelSize.y)).b;
      float T = texture(uDye, vUv + vec2(0.0, uTexelSize.y)).r + texture(uDye, vUv + vec2(0.0, uTexelSize.y)).g + texture(uDye, vUv + vec2(0.0, uTexelSize.y)).b;

      vec3 normal = normalize(vec3(R - L, T - B, 0.03));
      vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
      float diffuse = max(0.0, dot(normal, lightDir));

      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 reflectDir = reflect(-lightDir, normal);
      float spec = pow(max(0.0, dot(viewDir, reflectDir)), 32.0) * 1.2;

      color = color * (0.35 + 0.65 * diffuse) + vec3(spec);
    }

    // Add bloom glow
    vec3 bloom = texture(uBloom, vUv).rgb;
    color += bloom * uBloomIntensity;

    vec3 finalColor = uBgColor + color;
    fragColor = vec4(finalColor, 1.0);
  }
`;

// Bloom prefilter: extract bright parts above threshold with soft knee
const bloomPrefilterShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTexture;
  uniform vec3 uCurve;  // (threshold - knee, knee * 2, 0.25 / knee)
  uniform float uThreshold;
  void main() {
    vec3 c = texture(uTexture, vUv).rgb;
    float brightness = max(c.r, max(c.g, c.b));
    float soft = brightness - uCurve.x;
    soft = clamp(soft, 0.0, uCurve.y);
    soft = soft * soft * uCurve.z;
    float contribution = max(soft, brightness - uThreshold);
    contribution /= max(brightness, 0.0001);
    fragColor = vec4(c * contribution, 1.0);
  }
`;

// Bloom blur (Kawase-style downscale/upscale)
const bloomBlurShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTexture;
  uniform vec2 uTexelSize;
  void main() {
    vec4 sum = vec4(0.0);
    sum += texture(uTexture, vUv + vec2(-1.0, -1.0) * uTexelSize);
    sum += texture(uTexture, vUv + vec2( 1.0, -1.0) * uTexelSize);
    sum += texture(uTexture, vUv + vec2(-1.0,  1.0) * uTexelSize);
    sum += texture(uTexture, vUv + vec2( 1.0,  1.0) * uTexelSize);
    fragColor = sum * 0.25;
  }
`;

// Bloom final composite: additive blend of multiple blur levels
const bloomFinalShader = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uTexture;
  uniform float uIntensity;
  void main() {
    fragColor = texture(uTexture, vUv) * uIntensity;
  }
`;


interface TouchPointer {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  dx: number;
  dy: number;
  color: number[];
  moved: boolean;
}

export function FluidSimulationCanvas({ config }: { config: FluidConfig }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const appStorePoseLandmarks = useAppStore((s) => s.poseLandmarks);

  // Synchronize pose landmarks from app store to local ref
  const poseLandmarksRef = useRef<number[][] | null>(null);
  const prevPoseLandmarksRef = useRef<Record<number, { x: number; y: number }>>({});

  useEffect(() => {
    poseLandmarksRef.current = appStorePoseLandmarks;
  }, [appStorePoseLandmarks]);

  // Pointer state (mouse + multitouch)
  const pointerRef = useRef<TouchPointer>({
    id: -1,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    dx: 0,
    dy: 0,
    color: [1.0, 0.0, 0.5],
    moved: false,
  });

  const activeTouchesRef = useRef<Map<number, TouchPointer>>(new Map());

  // Config parameters mapped to dynamic refs to avoid re-initializing shaders/FBOs on state change
  const configRef = useRef<FluidConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Colors cycle index
  const colorIndexRef = useRef(0);
  const lastAmbientSplatTimeRef = useRef(0);

  const getNextColor = (): number[] => {
    const palette = COLOR_PALETTES[configRef.current.colorPalette] || COLOR_PALETTES["Neon Wave"];
    const col = palette[colorIndexRef.current % palette.length];
    colorIndexRef.current++;
    return [...col];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use WebGL2 for floating point framebuffers
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

    // Determine floating point support and linear filtering
    const extFloat = gl.getExtension('EXT_color_buffer_float');
    const extLinear = gl.getExtension('OES_texture_float_linear');

    // Set rendering texture properties based on device capabilities
    const internalFormat = extFloat ? gl.RGBA16F : gl.RGBA8;
    const format = gl.RGBA;
    const textureDataType = extFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const filterMode = (extLinear || !extFloat) ? gl.LINEAR : gl.NEAREST;

    // Resolution scale of the simulation grid (smaller grid = higher performance)
    const simScale = 0.25;
    const dyeScale = 0.85; // High resolution for sharp fluid trails and details
    let width = 0;
    let height = 0;
    let simWidth = 0;
    let simHeight = 0;
    let dyeWidth = 0;
    let dyeHeight = 0;

    // FBO instances
    let velocityFBO: DoubleFBO;
    let dyeFBO: DoubleFBO;
    let pressureFBO: DoubleFBO;
    let divergenceFBO: FBO;
    let curlFBO: FBO;
    const bloomFBOs: FBO[] = [];

    // Helpers to compile and create program
    const createShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
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
        console.error(gl.getProgramInfoLog(program));
        return null;
      }
      return program;
    };

    // Compile programs
    const clearProgram = createProgram(baseVertexShader, clearShader)!;
    const splatProgram = createProgram(baseVertexShader, splatShader)!;
    const advectProgram = createProgram(baseVertexShader, advectionShader)!;
    const divProgram = createProgram(baseVertexShader, divergenceShader)!;
    const curlProgram = createProgram(baseVertexShader, curlShader)!;
    const vorticityProgram = createProgram(baseVertexShader, vorticityShader)!;
    const pressureProgram = createProgram(baseVertexShader, pressureShader)!;
    const gradSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader)!;
    const displayProgram = createProgram(baseVertexShader, displayShader)!;
    const bloomPrefilterProgram = createProgram(baseVertexShader, bloomPrefilterShader)!;
    const bloomBlurProgram = createProgram(baseVertexShader, bloomBlurShader)!;
    const bloomFinalProgram = createProgram(baseVertexShader, bloomFinalShader)!;

    // Uniform locations caches
    const uniforms: Record<string, Record<string, WebGLUniformLocation>> = {};
    const cacheUniformLocations = (progName: string, program: WebGLProgram, keys: string[]) => {
      uniforms[progName] = {};
      keys.forEach(key => {
        const loc = gl.getUniformLocation(program, key);
        if (loc) uniforms[progName][key] = loc;
      });
    };

    cacheUniformLocations('clear', clearProgram, ['uTarget', 'uFactor']);
    cacheUniformLocations('splat', splatProgram, ['uTarget', 'uAspectRatio', 'uPoint', 'uColor', 'uRadius']);
    cacheUniformLocations('advect', advectProgram, ['uVelocity', 'uSource', 'uTexelSize', 'uDt', 'uDissipation']);
    cacheUniformLocations('div', divProgram, ['uVelocity', 'uTexelSize']);
    cacheUniformLocations('curl', curlProgram, ['uVelocity', 'uTexelSize']);
    cacheUniformLocations('vorticity', vorticityProgram, ['uVelocity', 'uCurl', 'uTexelSize', 'uCurlScale', 'uDt']);
    cacheUniformLocations('pressure', pressureProgram, ['uPressure', 'uDivergence', 'uTexelSize']);
    cacheUniformLocations('gradSubtract', gradSubtractProgram, ['uPressure', 'uVelocity', 'uTexelSize']);
    cacheUniformLocations('display', displayProgram, ['uDye', 'uBloom', 'uTexelSize', 'uBgColor', 'uShading', 'uBloomIntensity']);
    cacheUniformLocations('bloomPrefilter', bloomPrefilterProgram, ['uTexture', 'uCurve', 'uThreshold']);
    cacheUniformLocations('bloomBlur', bloomBlurProgram, ['uTexture', 'uTexelSize']);
    cacheUniformLocations('bloomFinal', bloomFinalProgram, ['uTexture', 'uIntensity']);

    // Setup full-screen quad VAO/VBO
    const positionAttributeLocation = gl.getAttribLocation(displayProgram, 'aPosition');
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

    // Framebuffer operations helper
    const createFBOInstance = (w: number, h: number): FBO => {
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

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1.0 / w,
        texelSizeY: 1.0 / h,
      };
    };

    const createDoubleFBOInstance = (w: number, h: number): DoubleFBO => {
      let fbo1 = createFBOInstance(w, h);
      let fbo2 = createFBOInstance(w, h);
      return {
        get read() { return fbo1; },
        get write() { return fbo2; },
        swap() {
          const temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        }
      };
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (width === w && height === h) return;

      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;

      simWidth = Math.round(w * simScale);
      simHeight = Math.round(h * simScale);
      dyeWidth = Math.round(w * dyeScale);
      dyeHeight = Math.round(h * dyeScale);

      // Clean up previous FBOs if they exist
      const deleteFBO = (f: FBO) => {
        gl.deleteTexture(f.texture);
        gl.deleteFramebuffer(f.fbo);
      };
      const deleteDoubleFBO = (df: DoubleFBO) => {
        deleteFBO(df.read);
        deleteFBO(df.write);
      };

      if (velocityFBO) deleteDoubleFBO(velocityFBO);
      if (dyeFBO) deleteDoubleFBO(dyeFBO);
      if (pressureFBO) deleteDoubleFBO(pressureFBO);
      if (divergenceFBO) deleteFBO(divergenceFBO);
      if (curlFBO) deleteFBO(curlFBO);
      bloomFBOs.forEach(f => deleteFBO(f));

      // Re-initialize FBO structures with new sizes (velocity low res, dye high res)
      velocityFBO = createDoubleFBOInstance(simWidth, simHeight);
      dyeFBO = createDoubleFBOInstance(dyeWidth, dyeHeight);
      pressureFBO = createDoubleFBOInstance(simWidth, simHeight);
      divergenceFBO = createFBOInstance(simWidth, simHeight);
      curlFBO = createFBOInstance(simWidth, simHeight);

      // Bloom FBO chain: progressively downscaled for multi-level blur
      bloomFBOs.length = 0;
      let bloomW = Math.round(w * 0.25);
      let bloomH = Math.round(h * 0.25);
      const BLOOM_ITERATIONS = 8;
      for (let i = 0; i < BLOOM_ITERATIONS; i++) {
        bloomW = Math.max(1, Math.round(bloomW));
        bloomH = Math.max(1, Math.round(bloomH));
        bloomFBOs.push(createFBOInstance(bloomW, bloomH));
        bloomW = Math.round(bloomW * 0.5);
        bloomH = Math.round(bloomH * 0.5);
      }
    };

    // Inits
    resize();

    // Splat injection utility
    const injectSplat = (
      x: number,
      y: number,
      dx: number,
      dy: number,
      color: number[],
      isPose: boolean = false,
      intensityMultiplier: number = 8.0,
      radiusOverride?: number
    ) => {
      const config = configRef.current;
      const aspect = width / height;
      const correctRadius = (r: number) => {
        if (aspect > 1.0) return r * aspect;
        return r;
      };
      const baseRadius = radiusOverride ?? (isPose ? config.splatRadius * 1.8 : config.splatRadius);
      const radius = correctRadius(baseRadius / 100.0);

      // 1. Splat velocity
      gl.useProgram(splatProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFBO.write.fbo);
      gl.viewport(0, 0, simWidth, simHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture);
      gl.uniform1i(uniforms.splat.uTarget, 0);
      gl.uniform1f(uniforms.splat.uAspectRatio, aspect);
      gl.uniform2f(uniforms.splat.uPoint, x, y);

      const forceMultiplier = isPose ? config.splatForce * 0.7 : config.splatForce;
      gl.uniform3f(uniforms.splat.uColor, dx * forceMultiplier, dy * forceMultiplier, 0);
      gl.uniform1f(uniforms.splat.uRadius, radius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      velocityFBO.swap();

      // 2. Splat dye (color) - runs on high-res dye FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, dyeFBO.write.fbo);
      gl.viewport(0, 0, dyeWidth, dyeHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dyeFBO.read.texture);
      gl.uniform3f(
        uniforms.splat.uColor,
        color[0] * intensityMultiplier,
        color[1] * intensityMultiplier,
        color[2] * intensityMultiplier
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      dyeFBO.swap();
    };

    // Update function triggered in requestAnimationFrame
    let lastTime = performance.now();

    const update = () => {
      const time = performance.now();
      let dt = (time - lastTime) / 1000.0;
      dt = Math.min(dt, 0.033); // Clamp dt to prevent numerical explosion on frame drops
      lastTime = time;

      resize();

      const config = configRef.current;

      gl.bindVertexArray(vao);

      // --- 1. Advection ---
      gl.useProgram(advectProgram);
      gl.viewport(0, 0, simWidth, simHeight);

      // Advect velocity field
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFBO.write.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture); // uVelocity
      gl.uniform1i(uniforms.advect.uVelocity, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture); // uSource
      gl.uniform1i(uniforms.advect.uSource, 1);

      gl.uniform2f(uniforms.advect.uTexelSize, velocityFBO.read.texelSizeX, velocityFBO.read.texelSizeY);
      gl.uniform1f(uniforms.advect.uDt, dt);
      gl.uniform1f(uniforms.advect.uDissipation, config.velocityDissipation);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      velocityFBO.swap();

      // Advect dye (color) field - runs on high-res dye FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, dyeFBO.write.fbo);
      gl.viewport(0, 0, dyeWidth, dyeHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture); // uVelocity

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, dyeFBO.read.texture); // uSource
      gl.uniform1i(uniforms.advect.uSource, 1);

      gl.uniform2f(uniforms.advect.uTexelSize, dyeFBO.read.texelSizeX, dyeFBO.read.texelSizeY);
      gl.uniform1f(uniforms.advect.uDissipation, config.dyeDissipation);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      dyeFBO.swap();

      // --- 2. Pointer splats ---
      // Mouse/Main Touch splat
      const p = pointerRef.current;
      if (p.moved) {
        p.moved = false;
        injectSplat(p.x, p.y, p.dx, p.dy, p.color);
      }

      // Multitouch splats
      activeTouchesRef.current.forEach(t => {
        if (t.moved) {
          t.moved = false;
          injectSplat(t.x, t.y, t.dx, t.dy, t.color);
        }
      });

      // --- 2.5 Ambient Auto-Splats ---
      // Periodically inject a random splat to keep background alive with swirling color fields
      const currentTime = performance.now();
      if (currentTime - lastAmbientSplatTimeRef.current > 250) {
        lastAmbientSplatTimeRef.current = currentTime;

        // Random position
        const rx = Math.random();
        const ry = Math.random();

        // Random velocity direction and scale
        const rdx = (Math.random() - 0.5) * 8.0;
        const rdy = (Math.random() - 0.5) * 8.0;

        // Pick random color from current palette
        const palette = COLOR_PALETTES[config.colorPalette] || COLOR_PALETTES["Neon Wave"];
        const randColor = palette[Math.floor(Math.random() * palette.length)] || [1.0, 0.0, 0.5];

        // Inject splat (radius slightly larger for soft clouds, lower intensity multiplier 6.0)
        injectSplat(rx, ry, rdx, rdy, randColor, false, 6.0, config.splatRadius * 3.5);
      }

      // --- 3. CV Skeleton Tracking Splats ---
      if (config.useCVInteraction && poseLandmarksRef.current) {
        const landmarks = poseLandmarksRef.current;
        // Key interaction points: 15 (left wrist), 16 (right wrist), 0 (nose/head)
        const jointsToTrack = [15, 16, 0];

        jointsToTrack.forEach(idx => {
          if (idx < landmarks.length) {
            const pt = landmarks[idx];
            if (pt && !isNaN(pt[0]) && !isNaN(pt[1])) {
              // Mirror coordinates so physical right arm controls right side of mirrored screen
              const x = 1.0 - pt[0];
              const y = pt[1]; // y is 0 at top, 1 at bottom

              const prev = prevPoseLandmarksRef.current[idx];
              if (prev) {
                const dx = (x - prev.x) * 45.0; // scale up velocity vector
                const dy = (y - prev.y) * 45.0;

                const speed = Math.hypot(dx, dy);
                if (speed > 0.08) {
                  // Splat some dye and force
                  const color = idx === 15 ? COLOR_PALETTES[config.colorPalette][0] || [0.9, 0.05, 0.6]
                    : idx === 16 ? COLOR_PALETTES[config.colorPalette][1] || [0.05, 0.9, 0.9]
                      : COLOR_PALETTES[config.colorPalette][2] || [0.7, 0.1, 0.9];

                  // Limit maximum injected velocity to avoid blowouts
                  const maxForce = 0.85;
                  const fScale = speed > maxForce ? maxForce / speed : 1.0;
                  injectSplat(x, 1.0 - y, dx * fScale, -dy * fScale, color, true, 7.0);
                }
              }
              prevPoseLandmarksRef.current[idx] = { x, y };
            }
          }
        });
      }

      // --- 4. Vorticity Confinement ---
      if (config.vorticity > 0.0) {
        // Calculate curl
        gl.useProgram(curlProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, curlFBO.fbo);
        gl.viewport(0, 0, simWidth, simHeight);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture);
        gl.uniform1i(uniforms.curl.uVelocity, 0);
        gl.uniform2f(uniforms.curl.uTexelSize, velocityFBO.read.texelSizeX, velocityFBO.read.texelSizeY);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Apply vorticity force
        gl.useProgram(vorticityProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFBO.write.fbo);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture);
        gl.uniform1i(uniforms.vorticity.uVelocity, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, curlFBO.texture);
        gl.uniform1i(uniforms.vorticity.uCurl, 1);

        gl.uniform2f(uniforms.vorticity.uTexelSize, velocityFBO.read.texelSizeX, velocityFBO.read.texelSizeY);
        gl.uniform1f(uniforms.vorticity.uCurlScale, config.vorticity);
        gl.uniform1f(uniforms.vorticity.uDt, dt);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        velocityFBO.swap();
      }

      // --- 5. Divergence ---
      gl.useProgram(divProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, divergenceFBO.fbo);
      gl.viewport(0, 0, simWidth, simHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture);
      gl.uniform1i(uniforms.div.uVelocity, 0);
      gl.uniform2f(uniforms.div.uTexelSize, velocityFBO.read.texelSizeX, velocityFBO.read.texelSizeY);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // --- 6. Pressure solver (Jacobi iteration) ---
      // Clear pressure read FBO first
      gl.useProgram(clearProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFBO.read.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture);
      gl.uniform1i(uniforms.clear.uTarget, 0);
      gl.uniform1f(uniforms.clear.uFactor, 0.8); // slight pressure decay
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.useProgram(pressureProgram);
      gl.viewport(0, 0, simWidth, simHeight);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, divergenceFBO.texture); // uDivergence
      gl.uniform1i(uniforms.pressure.uDivergence, 1);

      for (let i = 0; i < config.pressureIterations; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFBO.write.fbo);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture); // uPressure
        gl.uniform1i(uniforms.pressure.uPressure, 0);
        gl.uniform2f(uniforms.pressure.uTexelSize, pressureFBO.read.texelSizeX, pressureFBO.read.texelSizeY);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        pressureFBO.swap();
      }

      // --- 7. Gradient subtraction ---
      gl.useProgram(gradSubtractProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFBO.write.fbo);
      gl.viewport(0, 0, simWidth, simHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture); // uPressure
      gl.uniform1i(uniforms.gradSubtract.uPressure, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, velocityFBO.read.texture); // uVelocity
      gl.uniform1i(uniforms.gradSubtract.uVelocity, 1);

      gl.uniform2f(uniforms.gradSubtract.uTexelSize, velocityFBO.read.texelSizeX, velocityFBO.read.texelSizeY);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      velocityFBO.swap();

      // --- 8. Bloom Post-Processing ---
      // Bloom settings (matching PavelDoGreat's reference)
      const BLOOM_THRESHOLD = 0.6;
      const BLOOM_SOFT_KNEE = 0.7;
      const BLOOM_INTENSITY = 0.8;

      if (bloomFBOs.length > 0) {
        // Step 8a: Prefilter — extract bright areas
        const knee = BLOOM_THRESHOLD * BLOOM_SOFT_KNEE + 0.0001;
        const curve0 = BLOOM_THRESHOLD - knee;
        const curve1 = knee * 2.0;
        const curve2 = 0.25 / knee;

        gl.useProgram(bloomPrefilterProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].fbo);
        gl.viewport(0, 0, bloomFBOs[0].width, bloomFBOs[0].height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dyeFBO.read.texture);
        gl.uniform1i(uniforms.bloomPrefilter.uTexture, 0);
        gl.uniform3f(uniforms.bloomPrefilter.uCurve, curve0, curve1, curve2);
        gl.uniform1f(uniforms.bloomPrefilter.uThreshold, BLOOM_THRESHOLD);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Step 8b: Progressive downscale blur
        gl.useProgram(bloomBlurProgram);
        for (let i = 1; i < bloomFBOs.length; i++) {
          const src = bloomFBOs[i - 1];
          const dst = bloomFBOs[i];
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, dst.width, dst.height);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.texture);
          gl.uniform1i(uniforms.bloomBlur.uTexture, 0);
          gl.uniform2f(uniforms.bloomBlur.uTexelSize, src.texelSizeX, src.texelSizeY);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // Step 8c: Upscale blur (additive blend from small to large)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = bloomFBOs.length - 2; i >= 0; i--) {
          const src = bloomFBOs[i + 1];
          const dst = bloomFBOs[i];
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, dst.width, dst.height);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, src.texture);
          gl.uniform1i(uniforms.bloomBlur.uTexture, 0);
          gl.uniform2f(uniforms.bloomBlur.uTexelSize, src.texelSizeX, src.texelSizeY);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        gl.disable(gl.BLEND);
      }

      // --- 9. Render to screen ---
      gl.useProgram(displayProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Canvas backbuffer
      gl.viewport(0, 0, width, height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dyeFBO.read.texture);
      gl.uniform1i(uniforms.display.uDye, 0);

      // Bloom texture (first level has accumulated glow)
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBOs.length > 0 ? bloomFBOs[0].texture : dyeFBO.read.texture);
      gl.uniform1i(uniforms.display.uBloom, 1);

      gl.uniform2f(uniforms.display.uTexelSize, dyeFBO.read.texelSizeX, dyeFBO.read.texelSizeY);

      // Pure black background for optimal mix-blend-mode: screen compositing
      gl.uniform3f(uniforms.display.uBgColor, 0.0, 0.0, 0.0);
      gl.uniform1f(uniforms.display.uShading, config.shadingActive ? 1.0 : 0.0);
      gl.uniform1f(uniforms.display.uBloomIntensity, BLOOM_INTENSITY);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationFrameIdRef.current = requestAnimationFrame(update);
    };

    update();

    // Cleanup resources on unmount
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }

      // Geometries & shaders cleanup
      gl.deleteBuffer(quadBuffer);
      gl.deleteVertexArray(vao);

      const programs = [
        clearProgram, splatProgram, advectProgram, divProgram,
        curlProgram, vorticityProgram, pressureProgram,
        gradSubtractProgram, displayProgram,
        bloomPrefilterProgram, bloomBlurProgram, bloomFinalProgram
      ];
      programs.forEach(p => gl.deleteProgram(p));

      // FBO delete helpers
      const cleanFBO = (f: FBO) => {
        gl.deleteTexture(f.texture);
        gl.deleteFramebuffer(f.fbo);
      };
      const cleanDoubleFBO = (df: DoubleFBO) => {
        cleanFBO(df.read);
        cleanFBO(df.write);
      };

      if (velocityFBO) cleanDoubleFBO(velocityFBO);
      if (dyeFBO) cleanDoubleFBO(dyeFBO);
      if (pressureFBO) cleanDoubleFBO(pressureFBO);
      if (divergenceFBO) cleanFBO(divergenceFBO);
      if (curlFBO) cleanFBO(curlFBO);
      bloomFBOs.forEach(f => cleanFBO(f));
    };
  }, []);

  // --- Input Event Handlers ---

  const handlePointerDown = (clientX: number, clientY: number, id: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = 1.0 - (clientY - rect.top) / rect.height; // WebGL starts from bottom left
    const color = getNextColor();

    if (id === -1) {
      // Mouse
      pointerRef.current = {
        id,
        x,
        y,
        prevX: x,
        prevY: y,
        dx: 0,
        dy: 0,
        color,
        moved: true,
      };
    } else {
      // Touch
      activeTouchesRef.current.set(id, {
        id,
        x,
        y,
        prevX: x,
        prevY: y,
        dx: 0,
        dy: 0,
        color,
        moved: true,
      });
    }
  };

  const handlePointerMove = (clientX: number, clientY: number, id: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = 1.0 - (clientY - rect.top) / rect.height;

    if (id === -1) {
      // Mouse
      const p = pointerRef.current;
      if (p.id !== -1) return; // ignore move if pointer is not down
      p.dx = (x - p.x) * 35.0; // amplify velocity
      p.dy = (y - p.y) * 35.0;
      p.x = x;
      p.y = y;
      p.moved = true;
    } else {
      // Touch
      const t = activeTouchesRef.current.get(id);
      if (!t) return;
      t.dx = (x - t.x) * 35.0;
      t.dy = (y - t.y) * 35.0;
      t.x = x;
      t.y = y;
      t.moved = true;
    }
  };

  const handlePointerUp = (id: number) => {
    if (id === -1) {
      pointerRef.current.id = -1;
    } else {
      activeTouchesRef.current.delete(id);
    }
  };

  // Bind mouse handlers
  const onMouseDown = (e: React.MouseEvent) => {
    handlePointerDown(e.clientX, e.clientY, -1);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    // If mouse button is not pressed, treat id as -1 but only trigger splats when active
    if (e.buttons === 1) {
      pointerRef.current.id = 0; // mark active
      handlePointerMove(e.clientX, e.clientY, -1);
    } else {
      pointerRef.current.id = -1;
    }
  };

  const onMouseUp = () => {
    handlePointerUp(-1);
  };

  // Bind touch handlers
  const onTouchStart = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      handlePointerDown(touch.clientX, touch.clientY, touch.identifier);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      handlePointerMove(touch.clientX, touch.clientY, touch.identifier);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      handlePointerUp(touch.identifier);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="fluid-simulation-canvas"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2,
        mixBlendMode: 'screen',
        display: 'block',
      }}
    />
  );
}
