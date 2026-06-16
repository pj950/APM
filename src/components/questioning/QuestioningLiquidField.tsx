import { useMemo, useRef, type CSSProperties } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PersonalityDimensions } from '../../types';
import { createBestEffortWebGLRenderer, WebGLCanvasGuard } from '../WebGLCanvasGuard';

type QuestioningLiquidFieldProps = {
  dimensionKey: keyof PersonalityDimensions;
  openness: number;
  grip: number;
  energy: number;
};

type FieldPalette = {
  primary: string;
  secondary: string;
  deep: string;
};

const FIELD_PALETTES: Record<keyof PersonalityDimensions, FieldPalette> = {
  capital: { primary: '#d4af37', secondary: '#f4d03f', deep: '#3b2a08' },
  spirit: { primary: '#d946ef', secondary: '#f472b6', deep: '#2a0d2e' },
  intellect: { primary: '#06b6d4', secondary: '#22d3ee', deep: '#042434' },
  social: { primary: '#f97316', secondary: '#fb923c', deep: '#2f1708' },
  order: { primary: '#3b82f6', secondary: '#60a5fa', deep: '#081b3f' },
  energy: { primary: '#22c55e', secondary: '#86efac', deep: '#062614' },
};

const fieldVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fieldFragmentShader = /* glsl */ `
  uniform float u_time;
  uniform float u_open;
  uniform float u_grip;
  uniform float u_energy;
  uniform float u_style;
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform vec3 u_color_c;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;

    for (int i = 0; i < 6; i++) {
      value += amp * noise(p);
      p = mat2(1.7, -1.1, 1.1, 1.7) * p + 0.12;
      amp *= 0.54;
    }

    return value;
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv * 2.0 - 1.0;

    float time = u_time * (0.42 + u_energy * 0.36 + u_open * 0.2 + u_style * 0.12);
    float drift = 0.18 + u_open * 0.1 + u_style * 0.08;
    vec2 advected = centered;
    advected += vec2(sin(time * 0.72 + uv.y * (7.0 + u_style * 2.6)) * (0.045 + u_style * 0.012), 0.0);
    advected += vec2(0.0, cos(time * 0.54 + uv.x * (6.4 + u_style * 2.2)) * 0.038);
    advected += vec2(cos(time * 0.34 + centered.y * 5.4) * 0.03, sin(time * 0.28 + centered.x * 6.2) * 0.024);
    advected += vec2(sin(time * 0.2), cos(time * 0.22)) * drift;

    vec2 flowA = advected * (1.7 + u_style * 0.5) + vec2(time * 0.36, -time * 0.3);
    vec2 flowB = mat2(0.78, -0.62, 0.62, 0.78) * advected * (2.3 + u_style * 0.75) - vec2(time * 0.24, time * 0.42);
    vec2 flowC = mat2(0.92, 0.42, -0.42, 0.92) * advected * (2.1 + u_style * 0.62) + vec2(time * 0.18, -time * 0.24);

    float nA = fbm(flowA);
    float nB = fbm(flowB);
    float nC = fbm(flowC);

    float waves = sin((uv.y * (11.0 + u_style * 5.2) + nA * 8.4) - time * (5.6 + u_style * 2.4)) * 0.5 + 0.5;
    float bands = sin((uv.x * (9.0 + u_style * 3.0) - nB * 6.6) + time * (4.8 + u_style * 1.6)) * 0.5 + 0.5;
    float veins = sin((uv.y * (18.0 + u_style * 6.0) + nC * 10.2) - time * (7.6 + u_style * 3.2)) * 0.5 + 0.5;
    float fluid = clamp(nA * 0.5 + nB * 0.34 + nC * 0.3 + waves * 0.26 + veins * 0.14 - u_grip * 0.05, 0.0, 1.0);

    vec2 orbCenterA = vec2(0.34 + sin(time * 0.42) * 0.22, 0.28 + cos(time * 0.37) * 0.18);
    vec2 orbCenterB = vec2(0.72 + cos(time * 0.32 + 1.3) * 0.2, 0.66 + sin(time * 0.28 + 0.8) * 0.18);
    float orbA = smoothstep(0.32, 0.0, distance(uv, orbCenterA));
    float orbB = smoothstep(0.35, 0.0, distance(uv, orbCenterB));
    float bubbles = (orbA + orbB) * (0.24 + u_style * 0.18);

    vec3 base = mix(u_color_c, u_color_a, smoothstep(0.08, 0.88, fluid));
    vec3 tint = mix(u_color_a, u_color_b, smoothstep(0.24, 0.96, bands));
    vec3 glow = mix(u_color_b, vec3(1.0), 0.34) * smoothstep(0.52, 1.0, waves) * (0.2 + u_open * 0.12 + u_style * 0.08);
    vec3 stream = mix(u_color_a, u_color_b, 0.5) * smoothstep(0.6, 1.0, veins) * (0.18 + u_energy * 0.2);
    vec3 dust = vec3(1.0) * bubbles * 0.16;

    vec3 color = mix(base, tint, 0.58 + u_energy * 0.2);
    color += glow;
    color += stream;
    color += dust;

    float vignette = smoothstep(1.18, 0.24, length(centered * vec2(1.0, 0.84)));
    color *= (0.54 + vignette * 0.74);

    float alpha = 0.82;

    gl_FragColor = vec4(color, alpha);
  }
`;

function LiquidFieldShader({
  primary,
  secondary,
  deep,
  styleSeed,
  openness,
  grip,
  energy,
}: {
  primary: string;
  secondary: string;
  deep: string;
  styleSeed: number;
  openness: number;
  grip: number;
  energy: number;
}) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_open: { value: openness },
      u_grip: { value: grip },
      u_energy: { value: energy },
      u_style: { value: styleSeed },
      u_color_a: { value: new THREE.Color(primary) },
      u_color_b: { value: new THREE.Color(secondary) },
      u_color_c: { value: new THREE.Color(deep) },
    }),
    [deep, energy, grip, openness, primary, secondary, styleSeed],
  );

  useFrame((state) => {
    const material = materialRef.current;
    if (!material) return;

    material.uniforms.u_time.value = state.clock.getElapsedTime();
    material.uniforms.u_open.value += (openness - material.uniforms.u_open.value) * 0.05;
    material.uniforms.u_grip.value += (grip - material.uniforms.u_grip.value) * 0.05;
    material.uniforms.u_energy.value += (energy - material.uniforms.u_energy.value) * 0.05;
    material.uniforms.u_style.value += (styleSeed - material.uniforms.u_style.value) * 0.06;
    (material.uniforms.u_color_a.value as THREE.Color).set(primary);
    (material.uniforms.u_color_b.value as THREE.Color).set(secondary);
    (material.uniforms.u_color_c.value as THREE.Color).set(deep);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={fieldVertexShader}
        fragmentShader={fieldFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}

export function QuestioningLiquidField({
  dimensionKey,
  openness,
  grip,
  energy,
}: QuestioningLiquidFieldProps) {
  const palette = FIELD_PALETTES[dimensionKey];
  const styleSeed = useMemo(() => {
    const keys: Array<keyof PersonalityDimensions> = ['capital', 'spirit', 'intellect', 'social', 'order', 'energy'];
    const idx = keys.indexOf(dimensionKey);
    return idx < 0 ? 0 : idx / Math.max(keys.length - 1, 1);
  }, [dimensionKey]);

  return (
    <div className="questioning-liquid-field" aria-hidden="true">
      <WebGLCanvasGuard
        fallback={
          <div
            className="questioning-liquid-field__fallback"
            style={{
              '--dim-primary': palette.primary,
              '--dim-secondary': palette.secondary,
              '--dim-deep': palette.deep,
            } as CSSProperties}
          />
        }
      >
        <Canvas
          camera={{ position: [0, 0, 1.8], fov: 36 }}
          gl={(canvas) => createBestEffortWebGLRenderer(canvas as HTMLCanvasElement)}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          dpr={[0.85, 1.15]}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
        >
          <LiquidFieldShader
            primary={palette.primary}
            secondary={palette.secondary}
            deep={palette.deep}
            styleSeed={styleSeed}
            openness={openness}
            grip={grip}
            energy={energy}
          />
        </Canvas>
      </WebGLCanvasGuard>
    </div>
  );
}