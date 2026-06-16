import { useMemo, useRef, type CSSProperties } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PersonalityDimensions } from '../../types';
import { createBestEffortWebGLRenderer, WebGLCanvasGuard } from '../WebGLCanvasGuard';

type PortalLiquidCoreProps = {
  dimensionKey: keyof PersonalityDimensions;
  openness: number;
  grip: number;
  energy: number;
};

type PortalCorePalette = {
  primary: string;
  secondary: string;
};

const PORTAL_CORE_PALETTES: Record<keyof PersonalityDimensions, PortalCorePalette> = {
  capital: { primary: '#d4af37', secondary: '#f4d03f' },
  spirit: { primary: '#d946ef', secondary: '#f472b6' },
  intellect: { primary: '#06b6d4', secondary: '#22d3ee' },
  social: { primary: '#f97316', secondary: '#fb923c' },
  order: { primary: '#3b82f6', secondary: '#60a5fa' },
  energy: { primary: '#22c55e', secondary: '#86efac' },
};

const liquidCoreVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const liquidCoreFragmentShader = /* glsl */ `
  uniform float u_time;
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform float u_open;
  uniform float u_grip;
  uniform float u_energy;

  varying vec2 vUv;

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 point) {
    vec2 grid = floor(point);
    vec2 local = fract(point);
    vec2 blend = local * local * (3.0 - 2.0 * local);

    return mix(
      mix(hash(grid + vec2(0.0, 0.0)), hash(grid + vec2(1.0, 0.0)), blend.x),
      mix(hash(grid + vec2(0.0, 1.0)), hash(grid + vec2(1.0, 1.0)), blend.x),
      blend.y
    );
  }

  float fbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;

    for (int index = 0; index < 5; index++) {
      value += amplitude * noise(point);
      point = mat2(1.6, -1.2, 1.2, 1.6) * point + 0.15;
      amplitude *= 0.52;
    }

    return value;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float radius = length(uv);

    if (radius > 1.0) {
      discard;
    }

    float time = u_time * (0.45 + u_energy * 0.42 + u_open * 0.18);
    vec2 flowA = uv * (2.2 + u_open * 1.4) + vec2(time * 0.35, -time * 0.22);
    vec2 flowB = mat2(0.86, -0.5, 0.5, 0.86) * uv * (3.6 + u_grip * 1.3) - vec2(time * 0.18, time * 0.41);
    float swirl = atan(uv.y, uv.x);
    float noiseA = fbm(flowA);
    float noiseB = fbm(flowB);
    float band = sin(swirl * 5.0 - time * 2.4 + radius * 10.0);
    float caustic = sin((noiseA * 1.3 + noiseB * 1.1) * 9.0 - time * 4.2);
    float fluid = smoothstep(0.16, 0.92, noiseA * 0.62 + noiseB * 0.42 + band * 0.12 - radius * (0.42 + u_grip * 0.24));
    float coreMix = clamp(noiseA * 0.52 + (1.0 - radius) * 0.58 + u_open * 0.12, 0.0, 1.0);

    vec3 base = mix(u_color_a, u_color_b, coreMix);
    float rim = smoothstep(1.0, 0.46, radius);
    float centerPulse = smoothstep(0.56, 0.0, radius) * (0.72 + 0.28 * sin(time * 2.0 + noiseB * 6.2831));
    float highlightArc = smoothstep(0.34, 0.92, noiseB + band * 0.18) * rim * (0.45 + u_open * 0.32);
    float electric = smoothstep(0.62, 1.0, caustic * 0.5 + 0.5) * (0.18 + u_energy * 0.16) * rim;
    float darkPocket = smoothstep(0.24, 0.86, noiseA * 0.72 + noiseB * 0.36 - radius * 0.42) * 0.28;

    vec3 color = base * (0.42 + fluid * 0.96);
    color += mix(u_color_b, vec3(1.0), 0.42) * highlightArc;
    color += mix(u_color_a, vec3(1.0), 0.58) * centerPulse * 0.5;
    color += mix(u_color_b, vec3(1.0), 0.25) * electric;
    color *= 0.82 + fluid * 0.24 - darkPocket * 0.18;

    float alpha = smoothstep(1.06, 0.18, radius);
    alpha *= 0.5 + fluid * 0.34 + centerPulse * 0.12;

    gl_FragColor = vec4(color, alpha);
  }
`;

function LiquidCoreShader({
  primary,
  secondary,
  openness,
  grip,
  energy,
}: {
  primary: string;
  secondary: string;
  openness: number;
  grip: number;
  energy: number;
}) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_color_a: { value: new THREE.Color(primary) },
      u_color_b: { value: new THREE.Color(secondary) },
      u_open: { value: openness },
      u_grip: { value: grip },
      u_energy: { value: energy },
    }),
    [energy, grip, openness, primary, secondary],
  );

  useFrame((state) => {
    const material = materialRef.current;
    if (!material) {
      return;
    }

    // Self-heal size discrepancies between drawing buffer and CSS client bounds
    const canvas = state.gl.domElement;
    const clientW = canvas.clientWidth;
    const clientH = canvas.clientHeight;
    if (clientW > 0 && clientH > 0 && (state.size.width !== clientW || state.size.height !== clientH)) {
      state.setSize(clientW, clientH);
    }

    material.uniforms.u_time.value = state.clock.getElapsedTime();
    material.uniforms.u_open.value += (openness - material.uniforms.u_open.value) * 0.08;
    material.uniforms.u_grip.value += (grip - material.uniforms.u_grip.value) * 0.08;
    material.uniforms.u_energy.value += (energy - material.uniforms.u_energy.value) * 0.08;
    (material.uniforms.u_color_a.value as THREE.Color).set(primary);
    (material.uniforms.u_color_b.value as THREE.Color).set(secondary);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={liquidCoreVertexShader}
        fragmentShader={liquidCoreFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}

export function PortalLiquidCore({ dimensionKey, openness, grip, energy }: PortalLiquidCoreProps) {
  const palette = PORTAL_CORE_PALETTES[dimensionKey];

  return (
    <div className="portal-liquid-core" aria-hidden="true">
      <span className="portal-liquid-core__sheen" />
      <WebGLCanvasGuard
        fallback={
          <div
            className="portal-liquid-core__fallback"
            style={{
              '--inspect-open': openness,
              '--inspect-energy': energy,
            } as CSSProperties}
          >
            <div className="portal-aperture__liquid-wave portal-aperture__liquid-wave--a" />
            <div className="portal-aperture__liquid-wave portal-aperture__liquid-wave--b" />
            <div className="portal-aperture__liquid-wave portal-aperture__liquid-wave--c" />
            <div className="portal-liquid-core__sheen" />
          </div>
        }
      >
        <Canvas
          camera={{ position: [0, 0, 1.65], fov: 34 }}
          gl={(canvas) => createBestEffortWebGLRenderer(canvas as HTMLCanvasElement)}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          dpr={[1, 1.5]}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
        >
          <LiquidCoreShader
            primary={palette.primary}
            secondary={palette.secondary}
            openness={openness}
            grip={grip}
            energy={energy}
          />
        </Canvas>
      </WebGLCanvasGuard>
    </div>
  );
}