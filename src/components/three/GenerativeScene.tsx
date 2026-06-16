/**
 * Three.js/R3F 生成艺术模块
 * 根据 CV 数据和 Archetype 驱动粒子系统 Shader
 * STANDBY 阶段为太阳系开场，QUESTIONING 阶段显示 3D 面具，其他阶段显示粒子球。
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { getShaderPreset } from '../../shaders';
import type { VisualArchetype, VoicePresetKey } from '../../types';
import { MirrorFaceFallback, ScenePreset, resolveMaskKey } from '../dialogue/MirrorFace';
import {
  createBestEffortWebGLRenderer,
  getWebGLSupportDetails,
  type WebGLSupportDetails,
  WebGLCanvasGuard,
} from '../WebGLCanvasGuard';

type SolarControls = {
  expansion: number;
  rotationSpeed: number;
  tilt: number;
  timeScale: number;
  cameraLift: number;
};

type StandbySceneMode = 'solar' | 'collapse';
type CollapseDestination = 'QUESTIONING' | 'TAROT';

type SolarBodyConfig = {
  id: string;
  style: 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';
  size: number;
  secondaryColor: string;
  orbitColor: string;
  semiMajorAxis: number;
  eccentricity: number;
  inclinationDeg: number;
  phaseOffset: number;
  rotationSpeed: number;
  material: 'rocky' | 'gas' | 'ice' | 'cloud';
  axialTiltDeg?: number;
  hasRing?: boolean;
  ringInnerScale?: number;
  ringOuterScale?: number;
  ringTiltDeg?: number;
  ringColor?: string;
};

type PlanetTextureSet = {
  colorMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  cloudAlphaMap?: THREE.CanvasTexture;
};

const VOICE_MASK_MAP: Record<VoicePresetKey, VisualArchetype['baseType']> = {
  gollum: 'Flora',
  robot: 'Plasma',
  ethereal: 'Nebula',
  deep: 'Singularity',
  crystal: 'Crystal',
};

const DEFAULT_SOLAR_CONTROLS: SolarControls = {
  expansion: 1,
  rotationSpeed: 1,
  tilt: 0,
  timeScale: 1,
  cameraLift: 0,
};

const CANVAS_STAR_COUNT_NEAR = 1800;
const CANVAS_STAR_COUNT_FAR = 2600;

const SOLAR_BODIES: SolarBodyConfig[] = [
  {
    id: 'mercury',
    style: 'mercury',
    size: 0.045,
    secondaryColor: '#d6d3d1',
    orbitColor: '#a8a29e',
    semiMajorAxis: 0.68,
    eccentricity: 0.18,
    inclinationDeg: 7,
    phaseOffset: 0.1,
    rotationSpeed: 0.13,
    material: 'rocky',
    axialTiltDeg: 0.03,
  },
  {
    id: 'venus',
    style: 'venus',
    size: 0.082,
    secondaryColor: '#f59e0b',
    orbitColor: '#fcd34d',
    semiMajorAxis: 0.96,
    eccentricity: 0.07,
    inclinationDeg: 3.4,
    phaseOffset: 1.2,
    rotationSpeed: -0.04,
    material: 'cloud',
    axialTiltDeg: 177,
  },
  {
    id: 'earth',
    style: 'earth',
    size: 0.09,
    secondaryColor: '#38bdf8',
    orbitColor: '#7dd3fc',
    semiMajorAxis: 1.28,
    eccentricity: 0.03,
    inclinationDeg: 0,
    phaseOffset: 2.1,
    rotationSpeed: 0.48,
    material: 'rocky',
    axialTiltDeg: 23.4,
  },
  {
    id: 'mars',
    style: 'mars',
    size: 0.058,
    secondaryColor: '#fb923c',
    orbitColor: '#fdba74',
    semiMajorAxis: 1.78,
    eccentricity: 0.11,
    inclinationDeg: 1.85,
    phaseOffset: 0.9,
    rotationSpeed: 0.36,
    material: 'rocky',
    axialTiltDeg: 25.2,
  },
  {
    id: 'jupiter',
    style: 'jupiter',
    size: 0.22,
    secondaryColor: '#f59e0b',
    orbitColor: '#fbbf24',
    semiMajorAxis: 3.18,
    eccentricity: 0.05,
    inclinationDeg: 1.3,
    phaseOffset: 2.8,
    rotationSpeed: 0.92,
    material: 'gas',
    axialTiltDeg: 3.1,
  },
  {
    id: 'saturn',
    style: 'saturn',
    size: 0.19,
    secondaryColor: '#f8d38b',
    orbitColor: '#fde68a',
    semiMajorAxis: 4.18,
    eccentricity: 0.06,
    inclinationDeg: 2.5,
    phaseOffset: 0.45,
    rotationSpeed: 0.8,
    material: 'gas',
    axialTiltDeg: 26.7,
    hasRing: true,
    ringInnerScale: 1.55,
    ringOuterScale: 2.34,
    ringTiltDeg: 28,
    ringColor: '#fef3c7',
  },
  {
    id: 'uranus',
    style: 'uranus',
    size: 0.14,
    secondaryColor: '#7dd3fc',
    orbitColor: '#bae6fd',
    semiMajorAxis: 5.18,
    eccentricity: 0.03,
    inclinationDeg: 0.8,
    phaseOffset: 1.7,
    rotationSpeed: -0.54,
    material: 'ice',
    axialTiltDeg: 98,
    hasRing: true,
    ringInnerScale: 1.42,
    ringOuterScale: 1.92,
    ringTiltDeg: 98,
    ringColor: '#d9f99d',
  },
  {
    id: 'neptune',
    style: 'neptune',
    size: 0.136,
    secondaryColor: '#2563eb',
    orbitColor: '#60a5fa',
    semiMajorAxis: 6.08,
    eccentricity: 0.02,
    inclinationDeg: 1.8,
    phaseOffset: 2.4,
    rotationSpeed: 0.6,
    material: 'ice',
    axialTiltDeg: 28.3,
  },
];

function createSeededRandom(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return () => {
    hash += 0x6d2b79f5;
    let value = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createTextureCanvas(width: number, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createCanvasTexture(canvas: HTMLCanvasElement, detailed = false) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = detailed ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = detailed;
  texture.anisotropy = detailed ? 8 : 4;
  texture.needsUpdate = true;
  return texture;
}

function createRadialSpriteTexture(stops: Array<[number, string]>, size = 256) {
  const canvas = createTextureCanvas(size);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallback = createCanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.wrapS = THREE.ClampToEdgeWrapping;
    fallback.wrapT = THREE.ClampToEdgeWrapping;
    return fallback;
  }

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = createCanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createGlowTexture() {
  return createRadialSpriteTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.12, 'rgba(255,250,220,0.95)'],
    [0.34, 'rgba(255,196,110,0.38)'],
    [0.74, 'rgba(255,136,42,0.08)'],
    [1, 'rgba(0,0,0,0)'],
  ], 384);
}

function createSunSurfaceTexture() {
  const size = 768;
  const canvas = createTextureCanvas(size);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallback = createCanvasTexture(canvas, true);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  const random = createSeededRandom('solar-sun-surface');
  const baseGradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  baseGradient.addColorStop(0, '#fff3c2');
  baseGradient.addColorStop(0.28, '#ffd36b');
  baseGradient.addColorStop(0.62, '#ff9736');
  baseGradient.addColorStop(1, '#7c2d12');
  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, 0, size, size);

  for (let index = 0; index < 180; index += 1) {
    ctx.save();
    ctx.globalAlpha = 0.04 + random() * 0.08;
    ctx.fillStyle = index % 3 === 0 ? '#fff6d5' : index % 2 === 0 ? '#ffb84d' : '#ff7a1a';
    ctx.beginPath();
    ctx.ellipse(
      random() * size,
      random() * size,
      18 + random() * 80,
      12 + random() * 48,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  for (let index = 0; index < 28; index += 1) {
    const y = (index / 28) * size;
    const gradient = ctx.createLinearGradient(0, y, size, y + size * 0.08);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.3, `rgba(255,232,166,${0.05 + random() * 0.05})`);
    gradient.addColorStop(0.7, `rgba(255,155,61,${0.06 + random() * 0.08})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, size, size * 0.08);
  }

  const texture = createCanvasTexture(canvas, true);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawEllipses(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  width: number,
  height: number,
  palette: string[],
  alphaRange: [number, number],
  radiusXRange: [number, number],
  radiusYRange: [number, number],
  yRange: [number, number] = [0, height],
  xRange: [number, number] = [0, width],
) {
  for (let index = 0; index < count; index += 1) {
    ctx.save();
    ctx.globalAlpha = THREE.MathUtils.lerp(alphaRange[0], alphaRange[1], random());
    ctx.fillStyle = palette[Math.floor(random() * palette.length) % palette.length];
    ctx.beginPath();
    ctx.ellipse(
      THREE.MathUtils.lerp(xRange[0], xRange[1], random()),
      THREE.MathUtils.lerp(yRange[0], yRange[1], random()),
      THREE.MathUtils.lerp(radiusXRange[0], radiusXRange[1], random()),
      THREE.MathUtils.lerp(radiusYRange[0], radiusYRange[1], random()),
      THREE.MathUtils.lerp(-Math.PI, Math.PI, random()),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
}

function paintBands(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  width: number,
  height: number,
  palette: string[],
  bandCount: number,
  wobble = 20,
) {
  for (let index = 0; index < bandCount; index += 1) {
    const yTop = (index / bandCount) * height;
    const bandHeight = height / bandCount + height * 0.02;
    const phase = random() * Math.PI * 2;
    const nextColor = palette[(index + 1) % palette.length];
    const gradient = ctx.createLinearGradient(0, yTop, width, yTop + bandHeight);
    gradient.addColorStop(0, palette[index % palette.length]);
    gradient.addColorStop(0.55, nextColor);
    gradient.addColorStop(1, palette[index % palette.length]);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, yTop);
    for (let step = 0; step <= 48; step += 1) {
      const x = (step / 48) * width;
      const offset = Math.sin(step * 0.38 + phase) * wobble + Math.sin(step * 0.18 + phase * 0.4) * wobble * 0.4;
      ctx.lineTo(x, yTop + offset);
    }
    for (let step = 48; step >= 0; step -= 1) {
      const x = (step / 48) * width;
      const offset = Math.sin(step * 0.35 + phase + 0.8) * wobble + bandHeight;
      ctx.lineTo(x, yTop + offset);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function getPoseControls(poseLandmarks: number[][] | null): SolarControls {
  if (!poseLandmarks || poseLandmarks.length < 17) {
    return { ...DEFAULT_SOLAR_CONTROLS };
  }

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftWrist = poseLandmarks[15];
  const rightWrist = poseLandmarks[16];

  if (
    !leftShoulder || !rightShoulder || !leftWrist || !rightWrist ||
    isNaN(leftShoulder[0]) || isNaN(leftShoulder[1]) ||
    isNaN(rightShoulder[0]) || isNaN(rightShoulder[1]) ||
    isNaN(leftWrist[0]) || isNaN(leftWrist[1]) ||
    isNaN(rightWrist[0]) || isNaN(rightWrist[1])
  ) {
    return { ...DEFAULT_SOLAR_CONTROLS };
  }

  const shoulderWidth = Math.max(0.08, Math.abs(rightShoulder[0] - leftShoulder[0]));
  const leftLift = THREE.MathUtils.clamp((leftShoulder[1] - leftWrist[1]) / (shoulderWidth * 2.4), 0, 1.2);
  const rightLift = THREE.MathUtils.clamp((rightShoulder[1] - rightWrist[1]) / (shoulderWidth * 2.4), 0, 1.2);
  const openness = THREE.MathUtils.clamp(Math.abs(rightWrist[0] - leftWrist[0]) / (shoulderWidth * 2.8), 0, 1.2);
  const bothArms = THREE.MathUtils.clamp((leftLift + rightLift) * 0.5, 0, 1.2);

  return {
    expansion: 1 + openness * 0.12 + bothArms * 0.05,
    rotationSpeed: 1 + bothArms * 0.35,
    tilt: THREE.MathUtils.clamp((rightLift - leftLift) * 0.18, -0.32, 0.32),
    timeScale: 1 + bothArms * 0.28,
    cameraLift: THREE.MathUtils.clamp(bothArms * 0.12 - 0.02, -0.04, 0.16),
  };
}

function getCompressedOrbitSpeed(body: SolarBodyConfig) {
  return 0.3 / Math.pow(body.semiMajorAxis + 0.2, 1.15);
}

function getOrbitalPosition(body: SolarBodyConfig, angle: number) {
  const major = body.semiMajorAxis;
  const minor = major * Math.sqrt(1 - body.eccentricity * body.eccentricity);
  const x = Math.cos(angle) * major - major * body.eccentricity;
  const z = Math.sin(angle) * minor;
  const position = new THREE.Vector3(x, 0, z);
  position.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(body.inclinationDeg));
  return position;
}

function createRingTexture(body: SolarBodyConfig) {
  const width = 1024;
  const height = 128;
  const canvas = createTextureCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallback = createCanvasTexture(canvas, true);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  const random = createSeededRandom(`${body.id}-ring`);
  const palette = body.id === 'saturn'
    ? ['#fff8db', '#f8d38b', '#d6b67a', '#fff4c7']
    : ['#e0f2fe', '#cffafe', '#d9f99d', '#f0fdf4'];

  ctx.clearRect(0, 0, width, height);
  for (let column = 0; column < width; column += 1) {
    const t = column / (width - 1);
    const band = Math.floor(t * palette.length) % palette.length;
    const alpha = body.id === 'saturn'
      ? 0.1 + Math.sin(t * Math.PI * 18) * 0.06 + random() * 0.12
      : 0.03 + Math.sin(t * Math.PI * 8) * 0.03 + random() * 0.05;

    ctx.fillStyle = palette[band];
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillRect(column, 0, 1, height);
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, height * 0.38, width, 2);
  ctx.fillRect(0, height * 0.62, width, 2);

  const texture = createCanvasTexture(canvas, true);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createPlanetTextures(body: SolarBodyConfig): PlanetTextureSet {
  const size = 1024;
  const colorCanvas = createTextureCanvas(size);
  const roughnessCanvas = createTextureCanvas(size);
  const bumpCanvas = createTextureCanvas(size);
  const colorCtx = colorCanvas.getContext('2d');
  const roughnessCtx = roughnessCanvas.getContext('2d');
  const bumpCtx = bumpCanvas.getContext('2d');

  if (!colorCtx || !roughnessCtx || !bumpCtx) {
    const colorMap = createCanvasTexture(colorCanvas, true);
    const roughnessMap = createCanvasTexture(roughnessCanvas);
    const bumpMap = createCanvasTexture(bumpCanvas);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    return { colorMap, roughnessMap, bumpMap };
  }

  const random = createSeededRandom(`planet-${body.id}`);

  switch (body.style) {
    case 'earth': {
      const oceanGradient = colorCtx.createLinearGradient(0, 0, 0, size);
      oceanGradient.addColorStop(0, '#1d4ed8');
      oceanGradient.addColorStop(0.45, '#0f6dcb');
      oceanGradient.addColorStop(1, '#0b2747');
      colorCtx.fillStyle = oceanGradient;
      colorCtx.fillRect(0, 0, size, size);

      drawEllipses(colorCtx, random, 20, size, size, ['#d8d19b', '#6f8a4f', '#4b6a3c', '#325033'], [0.5, 0.9], [60, 240], [28, 110], [size * 0.12, size * 0.88]);
      drawEllipses(colorCtx, random, 120, size, size, ['#d8d19b', '#6b8f4e', '#527846', '#375535'], [0.08, 0.18], [8, 36], [4, 16], [size * 0.16, size * 0.84]);
      drawEllipses(colorCtx, random, 140, size, size, ['#8fd3ff', '#7cc8ff', '#d6f5ff'], [0.03, 0.08], [10, 80], [2, 10]);

      roughnessCtx.fillStyle = '#243647';
      roughnessCtx.fillRect(0, 0, size, size);
      drawEllipses(roughnessCtx, random, 26, size, size, ['#a3a3a3', '#b9b9b9', '#8f8f8f'], [0.35, 0.6], [50, 220], [24, 110], [size * 0.12, size * 0.88]);

      bumpCtx.fillStyle = '#3b5364';
      bumpCtx.fillRect(0, 0, size, size);
      drawEllipses(bumpCtx, random, 26, size, size, ['#b8c6b8', '#8faa84', '#d6dcc8'], [0.18, 0.38], [50, 210], [18, 96], [size * 0.12, size * 0.88]);
      break;
    }
    case 'venus': {
      colorCtx.fillStyle = '#f8d38b';
      colorCtx.fillRect(0, 0, size, size);
      paintBands(colorCtx, random, size, size, ['#fff1c2', '#facc76', '#f59e0b', '#b45309'], 18, 24);
      drawEllipses(colorCtx, random, 90, size, size, ['#fff7d6', '#fcd34d', '#fde68a'], [0.04, 0.1], [18, 120], [8, 24]);

      roughnessCtx.fillStyle = '#9a9a9a';
      roughnessCtx.fillRect(0, 0, size, size);
      paintBands(roughnessCtx, random, size, size, ['#8f8f8f', '#b0b0b0', '#757575'], 16, 14);

      bumpCtx.fillStyle = '#6d6d6d';
      bumpCtx.fillRect(0, 0, size, size);
      paintBands(bumpCtx, random, size, size, ['#727272', '#929292', '#5f5f5f'], 16, 10);
      break;
    }
    case 'mars': {
      const gradient = colorCtx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, '#c2410c');
      gradient.addColorStop(0.55, '#8b4513');
      gradient.addColorStop(1, '#4a2512');
      colorCtx.fillStyle = gradient;
      colorCtx.fillRect(0, 0, size, size);
      drawEllipses(colorCtx, random, 150, size, size, ['#f59e0b', '#fb923c', '#7c2d12', '#451a03'], [0.08, 0.16], [8, 90], [4, 36]);

      roughnessCtx.fillStyle = '#7f7f7f';
      roughnessCtx.fillRect(0, 0, size, size);
      drawEllipses(roughnessCtx, random, 160, size, size, ['#5f5f5f', '#a1a1aa', '#737373'], [0.1, 0.18], [8, 90], [4, 34]);

      bumpCtx.fillStyle = '#4f4f4f';
      bumpCtx.fillRect(0, 0, size, size);
      drawEllipses(bumpCtx, random, 180, size, size, ['#9a9a9a', '#555555', '#b7b7b7'], [0.08, 0.22], [6, 54], [6, 54]);
      break;
    }
    case 'jupiter': {
      paintBands(colorCtx, random, size, size, ['#fff7ed', '#e7c9a7', '#d6a874', '#9a6c43', '#f59e0b'], 24, 28);
      colorCtx.save();
      colorCtx.globalAlpha = 0.82;
      colorCtx.fillStyle = '#c2410c';
      colorCtx.beginPath();
      colorCtx.ellipse(size * 0.72, size * 0.58, size * 0.12, size * 0.08, -0.2, 0, Math.PI * 2);
      colorCtx.fill();
      colorCtx.restore();

      roughnessCtx.fillStyle = '#909090';
      roughnessCtx.fillRect(0, 0, size, size);
      paintBands(roughnessCtx, random, size, size, ['#7a7a7a', '#a8a8a8', '#8d8d8d'], 22, 12);

      bumpCtx.fillStyle = '#707070';
      bumpCtx.fillRect(0, 0, size, size);
      paintBands(bumpCtx, random, size, size, ['#8a8a8a', '#5e5e5e', '#9f9f9f'], 22, 10);
      break;
    }
    case 'saturn': {
      paintBands(colorCtx, random, size, size, ['#fff7d6', '#f8d38b', '#eab308', '#d6b67a', '#fef3c7'], 22, 18);
      drawEllipses(colorCtx, random, 60, size, size, ['#fff8db', '#fde68a', '#f5deb3'], [0.03, 0.07], [24, 180], [4, 18]);

      roughnessCtx.fillStyle = '#989898';
      roughnessCtx.fillRect(0, 0, size, size);
      paintBands(roughnessCtx, random, size, size, ['#8c8c8c', '#b2b2b2', '#9a9a9a'], 20, 10);

      bumpCtx.fillStyle = '#7a7a7a';
      bumpCtx.fillRect(0, 0, size, size);
      paintBands(bumpCtx, random, size, size, ['#8e8e8e', '#656565', '#9f9f9f'], 20, 8);
      break;
    }
    case 'uranus': {
      paintBands(colorCtx, random, size, size, ['#d9f99d', '#cffafe', '#7dd3fc', '#dbeafe'], 14, 10);
      roughnessCtx.fillStyle = '#8d8d8d';
      roughnessCtx.fillRect(0, 0, size, size);
      paintBands(roughnessCtx, random, size, size, ['#9f9f9f', '#858585', '#b0b0b0'], 10, 6);

      bumpCtx.fillStyle = '#777777';
      bumpCtx.fillRect(0, 0, size, size);
      paintBands(bumpCtx, random, size, size, ['#878787', '#666666', '#9d9d9d'], 10, 5);
      break;
    }
    case 'neptune': {
      paintBands(colorCtx, random, size, size, ['#bfdbfe', '#60a5fa', '#2563eb', '#1d4ed8', '#0f172a'], 16, 14);
      colorCtx.save();
      colorCtx.globalAlpha = 0.42;
      colorCtx.fillStyle = '#dbeafe';
      colorCtx.beginPath();
      colorCtx.ellipse(size * 0.68, size * 0.54, size * 0.08, size * 0.05, 0.15, 0, Math.PI * 2);
      colorCtx.fill();
      colorCtx.restore();

      roughnessCtx.fillStyle = '#8f8f8f';
      roughnessCtx.fillRect(0, 0, size, size);
      paintBands(roughnessCtx, random, size, size, ['#7a7a7a', '#a8a8a8', '#8d8d8d'], 14, 7);

      bumpCtx.fillStyle = '#717171';
      bumpCtx.fillRect(0, 0, size, size);
      paintBands(bumpCtx, random, size, size, ['#848484', '#5b5b5b', '#979797'], 14, 6);
      break;
    }
    default: {
      const gradient = colorCtx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, '#e7e5e4');
      gradient.addColorStop(0.4, '#a8a29e');
      gradient.addColorStop(1, '#44403c');
      colorCtx.fillStyle = gradient;
      colorCtx.fillRect(0, 0, size, size);
      drawEllipses(colorCtx, random, 200, size, size, ['#f5f5f4', '#78716c', '#57534e'], [0.06, 0.14], [6, 60], [6, 60]);

      roughnessCtx.fillStyle = '#969696';
      roughnessCtx.fillRect(0, 0, size, size);
      drawEllipses(roughnessCtx, random, 180, size, size, ['#7f7f7f', '#b5b5b5', '#5e5e5e'], [0.08, 0.16], [6, 48], [6, 48]);

      bumpCtx.fillStyle = '#696969';
      bumpCtx.fillRect(0, 0, size, size);
      drawEllipses(bumpCtx, random, 220, size, size, ['#8a8a8a', '#585858', '#bdbdbd'], [0.08, 0.22], [6, 42], [6, 42]);
      break;
    }
  }

  const colorMap = createCanvasTexture(colorCanvas, true);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = createCanvasTexture(roughnessCanvas);
  const bumpMap = createCanvasTexture(bumpCanvas);
  const cloudAlphaMap = body.id === 'earth'
    ? createPlanetCloudTexture('orbit-earth-clouds', 1.05)
    : body.id === 'venus'
      ? createPlanetCloudTexture('orbit-venus-clouds', 1.35)
      : undefined;

  return { colorMap, roughnessMap, bumpMap, cloudAlphaMap };
}

function createPlanetCloudTexture(seed: string, density = 1) {
  const size = 512;
  const canvas = createTextureCanvas(size);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallback = createCanvasTexture(canvas);
    fallback.wrapS = THREE.RepeatWrapping;
    fallback.wrapT = THREE.RepeatWrapping;
    return fallback;
  }

  const random = createSeededRandom(seed);
  ctx.clearRect(0, 0, size, size);

  const blobCount = Math.round(24 * density);
  const bandCount = Math.round(8 * density);

  for (let layer = 0; layer < Math.max(3, Math.round(2 + density * 2)); layer += 1) {
    ctx.save();
    ctx.globalAlpha = 0.02 + layer * 0.012;
    ctx.fillStyle = layer % 2 === 0 ? '#ffffff' : '#f0f9ff';
    ctx.beginPath();
    const bandY = size * (0.18 + layer * 0.18 + random() * 0.08);
    ctx.moveTo(-size * 0.08, bandY);
    ctx.bezierCurveTo(
      size * 0.2,
      bandY + THREE.MathUtils.lerp(-34, 34, random()),
      size * 0.62,
      bandY + THREE.MathUtils.lerp(-42, 42, random()),
      size * 1.08,
      bandY + THREE.MathUtils.lerp(-28, 28, random()),
    );
    ctx.lineTo(size * 1.08, bandY + 56 + random() * 26);
    ctx.lineTo(-size * 0.08, bandY + 56 + random() * 26);
    ctx.closePath();
    ctx.filter = 'blur(18px)';
    ctx.fill();
    ctx.restore();
  }

  for (let index = 0; index < blobCount; index += 1) {
    const centerX = THREE.MathUtils.lerp(size * 0.02, size * 0.98, random());
    const centerY = THREE.MathUtils.lerp(size * 0.08, size * 0.9, random());
    const radiusY = THREE.MathUtils.lerp(26, 82, random());
    const radiusX = radiusY * THREE.MathUtils.lerp(1.9, 4.2, random());
    const alpha = THREE.MathUtils.lerp(0.12, 0.34, random());
    const rotation = THREE.MathUtils.lerp(-0.9, 0.9, random());

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(radiusX / radiusY, 1);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusY);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.56, `rgba(255,255,255,${alpha * 0.72})`);
    gradient.addColorStop(0.84, `rgba(255,255,255,${alpha * 0.2})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radiusY, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let wisps = 0; wisps < Math.round(42 * density); wisps += 1) {
    ctx.save();
    ctx.globalAlpha = 0.04 + random() * 0.06;
    ctx.strokeStyle = wisps % 2 === 0 ? '#ffffff' : '#e0f2fe';
    ctx.lineWidth = 6 + random() * 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const startX = THREE.MathUtils.lerp(-size * 0.08, size * 0.82, random());
    const startY = THREE.MathUtils.lerp(size * 0.04, size * 0.94, random());
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + THREE.MathUtils.lerp(30, 120, random()),
      startY + THREE.MathUtils.lerp(-18, 18, random()),
      startX + THREE.MathUtils.lerp(120, 220, random()),
      startY + THREE.MathUtils.lerp(-26, 26, random()),
      startX + THREE.MathUtils.lerp(180, 320, random()),
      startY + THREE.MathUtils.lerp(-12, 12, random()),
    );
    ctx.filter = 'blur(6px)';
    ctx.stroke();
    ctx.restore();
  }

  for (let index = 0; index < bandCount; index += 1) {
    ctx.save();
    ctx.globalAlpha = 0.04 + random() * 0.08;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 18 + random() * 18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const startX = THREE.MathUtils.lerp(-size * 0.08, size * 0.58, random());
    const startY = THREE.MathUtils.lerp(size * 0.1, size * 0.9, random());
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + THREE.MathUtils.lerp(size * 0.18, size * 0.3, random()),
      startY + THREE.MathUtils.lerp(-28, 28, random()),
      startX + THREE.MathUtils.lerp(size * 0.34, size * 0.54, random()),
      startY + THREE.MathUtils.lerp(-24, 24, random()),
      startX + THREE.MathUtils.lerp(size * 0.56, size * 0.84, random()),
      startY + THREE.MathUtils.lerp(-18, 18, random()),
    );
    ctx.stroke();
    ctx.restore();
  }

  const texture = createCanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}


function getSurfaceMaterialSettings(body: SolarBodyConfig) {
  switch (body.material) {
    case 'gas':
      return { roughness: 0.74, clearcoat: 0.18, clearcoatRoughness: 0.32, bumpScale: 0.008 };
    case 'cloud':
      return { roughness: body.id === 'earth' ? 0.52 : 0.58, clearcoat: 0.52, clearcoatRoughness: 0.22, bumpScale: body.id === 'earth' ? 0.018 : 0.01 };
    case 'ice':
      return { roughness: 0.6, clearcoat: 0.34, clearcoatRoughness: 0.18, bumpScale: 0.02 };
    default:
      return { roughness: 0.88, clearcoat: 0.06, clearcoatRoughness: 0.56, bumpScale: 0.034 };
  }
}

function getAtmosphereSettings(body: SolarBodyConfig) {
  if (body.id === 'earth') {
    return { color: '#7dd3fc', opacity: 0.18, scale: 1.08 };
  }

  if (body.id === 'venus') {
    return { color: '#fde68a', opacity: 0.12, scale: 1.05 };
  }

  if (body.id === 'mars') {
    return { color: '#fb923c', opacity: 0.04, scale: 1.03 };
  }

  if (body.material === 'gas') {
    return { color: body.secondaryColor, opacity: 0.05, scale: 1.03 };
  }

  if (body.material === 'ice') {
    return { color: body.secondaryColor, opacity: 0.1, scale: 1.07 };
  }

  return { color: body.secondaryColor, opacity: 0.02, scale: 1.02 };
}

function ParticleSphere() {
  const meshRef = useRef<THREE.Points>(null!);
  const cvData = useAppStore((s) => s.cvData);
  const archetype = useAppStore((s) => s.calculatedArchetype);
  const currentStage = useAppStore((s) => s.currentStage);
  const isVisible = currentStage !== 'SCANNING';

  const baseType: VisualArchetype['baseType'] = archetype?.baseType || 'Crystal';
  const preset = useMemo(() => getShaderPreset(baseType), [baseType]);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_noise_strength: { value: 0.3 },
      u_speed: { value: 0.5 },
      u_collapse: { value: 0 },
      u_color_a: { value: new THREE.Color(preset.colors[0]) },
      u_color_b: { value: new THREE.Color(preset.colors[1]) },
      u_bloom_intensity: { value: 0.5 },
    }),
    [preset],
  );

  const collapseRef = useRef(0);
  const collapseTargetRef = useRef(0);

  useEffect(() => {
    collapseTargetRef.current = currentStage === 'GENERATING' ? 1 : 0;
  }, [currentStage]);

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    uniforms.u_time.value = elapsed;
    uniforms.u_noise_strength.value = 0.2 + cvData.movementScore * 0.8;
    uniforms.u_speed.value = 0.3 + cvData.movementScore * 1.5;
    uniforms.u_bloom_intensity.value = 0.3 + cvData.smileScore * 1.2;

    collapseRef.current += (collapseTargetRef.current - collapseRef.current) * 0.03;
    uniforms.u_collapse.value = collapseRef.current;
    uniforms.u_color_a.value.set(preset.colors[0]);
    uniforms.u_color_b.value.set(preset.colors[1]);

    if (meshRef.current) {
      meshRef.current.rotation.y += 0.002;
      meshRef.current.rotation.x += 0.001;
    }
  });

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1.5, 48), []);

  return (
    <points ref={meshRef} visible={isVisible}>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial
        key={baseType}
        uniforms={uniforms}
        vertexShader={preset.vertexShader}
        fragmentShader={preset.fragmentShader}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

function NoiseBackground() {
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_opacity: { value: 0.06 },
    }),
    [],
  );

  const bgVertex = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  const bgFragment = /* glsl */ `
    uniform float u_time;
    uniform float u_opacity;
    varying vec2 vUv;

    float random(vec2 st) {
      return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      float noise = random(vUv * 1000.0 + u_time * 0.1);
      float scanline = sin(vUv.y * 800.0 + u_time * 2.0) * 0.02;
      float alpha = noise * u_opacity + scanline;
      gl_FragColor = vec4(vec3(noise * 0.5), alpha);
    }
  `;

  useFrame((state) => {
    uniforms.u_time.value = state.clock.getElapsedTime();
  });

  return (
    <mesh renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={bgVertex}
        fragmentShader={bgFragment}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function StarFieldLayer({
  count,
  radiusMin,
  radiusMax,
  size,
  drift,
  opacity = 0.88,
}: {
  count: number;
  radiusMin: number;
  radiusMax: number;
  size: number;
  drift: number;
  opacity?: number;
}) {
  const pointsRef = useRef<THREE.Points>(null!);

  const [positions, colors] = useMemo(() => {
    const starPositions = new Float32Array(count * 3);
    const starColors = new Float32Array(count * 3);
    const warm = new THREE.Color('#ffd8a8');
    const cold = new THREE.Color('#bcd7ff');
    const neutral = new THREE.Color('#ffffff');

    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = THREE.MathUtils.lerp(radiusMin, radiusMax, Math.random());

      starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index * 3 + 1] = radius * Math.cos(phi);
      starPositions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const mixed = neutral.clone().lerp(index % 5 === 0 ? warm : cold, Math.random() * 0.45);
      starColors[index * 3] = mixed.r;
      starColors[index * 3 + 1] = mixed.g;
      starColors[index * 3 + 2] = mixed.b;
    }

    return [starPositions, starColors];
  }, [count, radiusMax, radiusMin]);

  useFrame((_state, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * drift;
    pointsRef.current.rotation.x += delta * drift * 0.3;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        vertexColors
        transparent
        opacity={opacity}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

function NebulaGlowLayer() {
  return null;
}

function HeroStarLayer() {
  const groupRef = useRef<THREE.Group>(null!);

  const texture = useMemo(
    () => createRadialSpriteTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.14, 'rgba(255,255,255,0.98)'],
      [0.34, 'rgba(255,255,255,0.28)'],
      [1, 'rgba(255,255,255,0)'],
    ], 192),
    [],
  );

  const stars = useMemo(() => {
    const random = createSeededRandom('hero-stars');
    const palette = ['#ffffff', '#dbeafe', '#bfdbfe', '#fde68a', '#fef3c7'];

    return Array.from({ length: 28 }, (_, index) => {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = THREE.MathUtils.lerp(12, 24, random());

      return {
        position: [
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        ] as [number, number, number],
        scale: THREE.MathUtils.lerp(0.16, 0.44, random()),
        opacity: THREE.MathUtils.lerp(0.28, 0.9, random()),
        twinkle: THREE.MathUtils.lerp(0.7, 1.8, random()),
        phase: random() * Math.PI * 2,
        color: palette[index % palette.length],
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    groupRef.current.rotation.y -= delta * 0.0014;
    groupRef.current.children.forEach((child, index) => {
      if (!(child instanceof THREE.Sprite)) return;
      const star = stars[index];
      const material = child.material as THREE.SpriteMaterial;
      const twinkle = 0.88 + Math.sin(state.clock.getElapsedTime() * star.twinkle + star.phase) * 0.24;
      material.opacity = star.opacity * twinkle;
      child.scale.setScalar(star.scale * (0.9 + twinkle * 0.18));
    });
  });

  return (
    <group ref={groupRef}>
      {stars.map((star, index) => (
        <sprite key={`hero-star-${index}`} position={star.position} scale={[star.scale, star.scale, 1]}>
          <spriteMaterial
            map={texture}
            color={star.color}
            transparent
            opacity={star.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

function MilkyWayBand() {
  const groupRef = useRef<THREE.Group>(null!);

  const textures = useMemo(
    () => [
      createRadialSpriteTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.12, 'rgba(255,255,255,0.95)'],
        [0.34, 'rgba(186,230,253,0.34)'],
        [0.72, 'rgba(14,116,144,0.08)'],
        [1, 'rgba(0,0,0,0)'],
      ], 320),
      createRadialSpriteTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.12, 'rgba(255,255,255,0.9)'],
        [0.32, 'rgba(233,213,255,0.3)'],
        [0.72, 'rgba(88,28,135,0.08)'],
        [1, 'rgba(0,0,0,0)'],
      ], 320),
      createRadialSpriteTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.12, 'rgba(255,255,255,0.92)'],
        [0.28, 'rgba(254,240,138,0.2)'],
        [0.7, 'rgba(120,53,15,0.06)'],
        [1, 'rgba(0,0,0,0)'],
      ], 320),
    ],
    [],
  );

  const bands = useMemo(() => {
    const random = createSeededRandom('milky-way-band');

    return Array.from({ length: 16 }, (_, index) => {
      const t = index / 15;
      const coreFactor = 1 - Math.abs(t - 0.5) * 1.85;

      return {
        position: [
          THREE.MathUtils.lerp(-13.8, 12.8, t),
          THREE.MathUtils.lerp(6.2, -5.2, t) + Math.sin(t * Math.PI * 1.35) * 1.6,
          THREE.MathUtils.lerp(-19.5, -25.8, t) - Math.sin(t * Math.PI) * 1.7,
        ] as [number, number, number],
        scale: [
          THREE.MathUtils.lerp(4.8, 8.8, 0.22 + coreFactor * 0.78),
          THREE.MathUtils.lerp(1.6, 3.4, random()),
          1,
        ] as [number, number, number],
        color: index % 5 === 0 ? '#fde68a' : index % 2 === 0 ? '#dbeafe' : '#e9d5ff',
        opacity: THREE.MathUtils.lerp(0.08, 0.2, Math.max(0.12, coreFactor)),
        pulse: THREE.MathUtils.lerp(0.08, 0.22, random()),
        phase: random() * Math.PI * 2,
        textureIndex: index % textures.length,
      };
    });
  }, [textures.length]);

  useEffect(() => {
    return () => {
      textures.forEach((texture) => texture.dispose());
    };
  }, [textures]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    groupRef.current.rotation.y += delta * 0.0009;
    groupRef.current.children.forEach((child, index) => {
      if (!(child instanceof THREE.Sprite)) return;
      const band = bands[index];
      const material = child.material as THREE.SpriteMaterial;
      const pulse = 0.9 + Math.sin(state.clock.getElapsedTime() * band.pulse + band.phase) * 0.1;
      material.opacity = band.opacity * pulse;
    });
  });

  return (
    <group ref={groupRef}>
      {bands.map((band, index) => (
        <sprite
          key={`milky-way-band-${index}`}
          position={band.position}
          scale={band.scale}
        >
          <spriteMaterial
            map={textures[band.textureIndex]}
            color={band.color}
            transparent
            opacity={band.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

function GalacticDustBand() {
  const pointsRef = useRef<THREE.Points>(null!);

  const [positions, colors] = useMemo(() => {
    const random = createSeededRandom('galactic-dust-band');
    const count = 5200;
    const pointPositions = new Float32Array(count * 3);
    const pointColors = new Float32Array(count * 3);
    const coreWhite = new THREE.Color('#ffffff');
    const warm = new THREE.Color('#fde68a');
    const cold = new THREE.Color('#bfdbfe');

    for (let index = 0; index < count; index += 1) {
      const t = random() * 2 - 1;
      const coreFactor = 1 - Math.min(1, Math.abs(t));
      const x = t * 17.5;
      const y = (random() - 0.5) * (0.25 + coreFactor * 1.9);
      const z = (random() - 0.5) * (1.4 + coreFactor * 4.4);

      pointPositions[index * 3] = x;
      pointPositions[index * 3 + 1] = y;
      pointPositions[index * 3 + 2] = z;

      const baseColor = coreWhite.clone().lerp(index % 4 === 0 ? warm : cold, random() * 0.35);
      const brightened = baseColor.lerp(coreWhite, coreFactor * 0.42);
      pointColors[index * 3] = brightened.r;
      pointColors[index * 3 + 1] = brightened.g;
      pointColors[index * 3 + 2] = brightened.b;
    }

    return [pointPositions, pointColors];
  }, []);

  useFrame((_state, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.z += delta * 0.0012;
    pointsRef.current.rotation.y -= delta * 0.0016;
  });

  return (
    <group position={[0.5, 0.45, -22]} rotation={[0.28, -0.54, -0.7]}>
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.048}
          vertexColors
          transparent
          opacity={0.46}
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

function OrbitPath3D({ body }: { body: SolarBodyConfig }) {
  const points = useMemo(() => {
    const orbitPoints: number[] = [];

    for (let step = 0; step <= 128; step += 1) {
      const position = getOrbitalPosition(body, (step / 128) * Math.PI * 2);
      orbitPoints.push(position.x, position.y, position.z);
    }

    return new Float32Array(orbitPoints);
  }, [body]);

  const orbitLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

    const material = new THREE.LineBasicMaterial({
      color: body.orbitColor,
      transparent: true,
      opacity: 0.1,
      toneMapped: false,
    });

    const line = new THREE.LineLoop(geometry, material);
    line.frustumCulled = false;
    return line;
  }, [body.orbitColor, points]);

  useEffect(() => {
    return () => {
      orbitLine.geometry.dispose();
      (orbitLine.material as THREE.Material).dispose();
    };
  }, [orbitLine]);

  return <primitive object={orbitLine} />;
}

function AsteroidBelt({ motionRef }: { motionRef: { current: SolarControls } }) {
  const pointsRef = useRef<THREE.Points>(null!);

  const positions = useMemo(() => {
    const asteroidPositions = new Float32Array(780 * 3);

    for (let index = 0; index < 780; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.24 + Math.random() * 0.38;
      asteroidPositions[index * 3] = Math.cos(angle) * radius;
      asteroidPositions[index * 3 + 1] = (Math.random() - 0.5) * 0.08;
      asteroidPositions[index * 3 + 2] = Math.sin(angle) * radius;
    }

    return asteroidPositions;
  }, []);

  useFrame((_state, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * 0.04 * motionRef.current.rotationSpeed;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#fde68a"
        size={0.018}
        transparent
        opacity={0.45}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

function SolarSun() {
  const lightRef = useRef<THREE.PointLight>(null!);
  const surfaceRef = useRef<THREE.Mesh>(null!);
  const innerGlowRef = useRef<THREE.Sprite>(null!);
  const outerGlowRef = useRef<THREE.Sprite>(null!);
  const surfaceTexture = useMemo(() => createSunSurfaceTexture(), []);
  const glowTexture = useMemo(() => createGlowTexture(), []);

  useEffect(() => {
    return () => {
      surfaceTexture.dispose();
      glowTexture.dispose();
    };
  }, [glowTexture, surfaceTexture]);

  useFrame((state, delta) => {
    const pulse = 1 + Math.sin(state.clock.getElapsedTime() * 1.6) * 0.04;

    if (surfaceRef.current) {
      surfaceRef.current.rotation.y += delta * 0.14;
    }

    if (innerGlowRef.current) {
      innerGlowRef.current.scale.setScalar(1.05 * pulse);
    }

    if (outerGlowRef.current) {
      outerGlowRef.current.scale.set(2.55 + pulse * 0.24, 2.55 + pulse * 0.24, 1);
    }

    if (lightRef.current) {
      lightRef.current.intensity = 4.2 + Math.sin(state.clock.getElapsedTime() * 1.1) * 0.34;
    }
  });

  return (
    <group>
      <pointLight ref={lightRef} color="#ffbc6d" intensity={4.2} distance={22} decay={1.6} />
      <mesh ref={surfaceRef}>
        <sphereGeometry args={[0.35, 48, 48]} />
        <meshBasicMaterial map={surfaceTexture} color="#ffd08b" toneMapped={false} />
      </mesh>
      <sprite ref={innerGlowRef} scale={[1.05, 1.05, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#ffcf78"
          transparent
          opacity={0.72}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={outerGlowRef} scale={[2.8, 2.8, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#ff9747"
          transparent
          opacity={0.26}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

function SolarPlanet({
  body,
  motionRef,
  onSelect,
}: {
  body: SolarBodyConfig;
  motionRef: { current: SolarControls };
  onSelect?: () => void;
}) {
  const orbitRef = useRef<THREE.Group>(null!);
  const surfaceRef = useRef<THREE.Mesh>(null!);
  const cloudRef = useRef<THREE.Mesh>(null!);
  const atmosphereRef = useRef<THREE.Mesh>(null!);
  const selectableGlowRef = useRef<THREE.Sprite>(null!);
  const angleRef = useRef(body.phaseOffset);
  const textures = useMemo(() => createPlanetTextures(body), [body]);
  const ringTexture = useMemo(() => (body.hasRing ? createRingTexture(body) : null), [body]);
  const materialSettings = useMemo(() => getSurfaceMaterialSettings(body), [body]);
  const atmosphere = useMemo(() => getAtmosphereSettings(body), [body]);
  const selectableGlowTexture = useMemo(
    () => (onSelect
      ? (body.id === 'mars'
        ? createRadialSpriteTexture([
          [0, 'rgba(255,240,220,1)'],
          [0.16, 'rgba(255,210,150,0.96)'],
          [0.34, 'rgba(251,146,60,0.5)'],
          [0.66, 'rgba(194,65,12,0.16)'],
          [1, 'rgba(0,0,0,0)'],
        ], 360)
        : createRadialSpriteTexture([
          [0, 'rgba(255,255,255,1)'],
          [0.16, 'rgba(255,255,255,0.96)'],
          [0.34, 'rgba(147,197,253,0.4)'],
          [0.66, 'rgba(59,130,246,0.14)'],
          [1, 'rgba(0,0,0,0)'],
        ], 320))
      : null),
    [body.id, onSelect],
  );
  const [isHovered, setIsHovered] = useState(false);
  const isSelectable = (body.id === 'earth' || body.id === 'mars') && Boolean(onSelect);
  const glowColor = body.id === 'mars' ? '#ffb07a' : '#bfe8ff';

  useEffect(() => {
    return () => {
      textures.colorMap.dispose();
      textures.roughnessMap.dispose();
      textures.bumpMap.dispose();
      textures.cloudAlphaMap?.dispose();
      ringTexture?.dispose();
      selectableGlowTexture?.dispose();
    };
  }, [ringTexture, selectableGlowTexture, textures]);

  useEffect(() => {
    if (!isSelectable) return undefined;

    document.body.style.cursor = isHovered ? 'pointer' : 'default';

    return () => {
      document.body.style.cursor = 'default';
    };
  }, [isHovered, isSelectable]);

  useFrame((state, delta) => {
    if (!orbitRef.current) return;

    // Safety check to prevent NaN propagation
    if (
      isNaN(motionRef.current.timeScale) || !isFinite(motionRef.current.timeScale) ||
      isNaN(motionRef.current.rotationSpeed) || !isFinite(motionRef.current.rotationSpeed)
    ) {
      motionRef.current = { ...DEFAULT_SOLAR_CONTROLS };
    }

    angleRef.current += delta * getCompressedOrbitSpeed(body) * motionRef.current.timeScale;
    if (isNaN(angleRef.current) || !isFinite(angleRef.current)) {
      angleRef.current = body.phaseOffset;
    }

    orbitRef.current.position.copy(getOrbitalPosition(body, angleRef.current));

    if (surfaceRef.current) {
      surfaceRef.current.rotation.y += delta * body.rotationSpeed * (0.65 + motionRef.current.rotationSpeed * 0.22);
    }

    if (cloudRef.current) {
      cloudRef.current.rotation.y += delta * (Math.abs(body.rotationSpeed) * 1.4 + 0.05);
    }

    if (atmosphereRef.current) {
      atmosphereRef.current.rotation.y -= delta * 0.03;
    }

    if (selectableGlowRef.current) {
      const pulse = 0.9 + Math.sin(state.clock.getElapsedTime() * 2.4) * 0.08;
      const hoverBoost = isHovered ? 0.2 : 0;
      selectableGlowRef.current.scale.set(
        body.size * (9.2 + hoverBoost * 3.2) * pulse,
        body.size * (9.2 + hoverBoost * 3.2) * pulse,
        1,
      );
      const material = selectableGlowRef.current.material as THREE.SpriteMaterial;
      material.opacity = 0.24 + (isHovered ? 0.22 : 0) + Math.sin(state.clock.getElapsedTime() * 2.6) * 0.04;
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.();
  };

  return (
    <group ref={orbitRef}>
      <group rotation={[0, 0, THREE.MathUtils.degToRad(body.axialTiltDeg ?? 0)]}>
        {isSelectable && selectableGlowTexture ? (
          <sprite ref={selectableGlowRef} scale={[body.size * 9.2, body.size * 9.2, 1]}>
            <spriteMaterial
              map={selectableGlowTexture}
              color={glowColor}
              transparent
              opacity={0.24}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </sprite>
        ) : null}

        <mesh ref={surfaceRef}>
          <sphereGeometry args={[body.size, 48, 48]} />
          <meshPhysicalMaterial
            map={textures.colorMap}
            bumpMap={textures.bumpMap}
            bumpScale={materialSettings.bumpScale}
            roughnessMap={textures.roughnessMap}
            roughness={materialSettings.roughness}
            clearcoat={materialSettings.clearcoat}
            clearcoatRoughness={materialSettings.clearcoatRoughness}
            metalness={0.02}
            color="#ffffff"
          />
        </mesh>

        {textures.cloudAlphaMap ? (
          <mesh ref={cloudRef} scale={[1.028, 1.028, 1.028]}>
            <sphereGeometry args={[body.size, 40, 40]} />
            <meshPhysicalMaterial
              alphaMap={textures.cloudAlphaMap}
              color={body.id === 'earth' ? '#ffffff' : body.secondaryColor}
              transparent
              opacity={body.id === 'venus' ? 0.52 : 0.36}
              depthWrite={false}
              roughness={0.25}
              metalness={0}
              clearcoat={1}
              clearcoatRoughness={0.18}
            />
          </mesh>
        ) : null}

        {atmosphere.opacity > 0 ? (
          <mesh ref={atmosphereRef} scale={[atmosphere.scale, atmosphere.scale, atmosphere.scale]}>
            <sphereGeometry args={[body.size, 36, 36]} />
            <meshBasicMaterial
              color={atmosphere.color}
              transparent
              opacity={atmosphere.opacity}
              side={THREE.BackSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ) : null}

        {body.hasRing ? (
          <>
            <mesh rotation={[THREE.MathUtils.degToRad(body.ringTiltDeg ?? 26), 0, 0]}>
              <ringGeometry
                args={[
                  body.size * (body.ringInnerScale ?? 1.5),
                  body.size * (body.ringOuterScale ?? 2.2),
                  96,
                ]}
              />
              <meshStandardMaterial
                map={ringTexture ?? undefined}
                alphaMap={ringTexture ?? undefined}
                color={body.ringColor ?? body.secondaryColor}
                transparent
                opacity={body.id === 'saturn' ? 0.82 : 0.24}
                alphaTest={body.id === 'saturn' ? 0.02 : 0.005}
                roughness={0.92}
                metalness={0.01}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh scale={[1.02, 1.02, 1.02]} rotation={[THREE.MathUtils.degToRad(body.ringTiltDeg ?? 26), 0, 0]}>
              <ringGeometry
                args={[
                  body.size * (body.ringInnerScale ?? 1.5) * 0.98,
                  body.size * (body.ringOuterScale ?? 2.2) * 1.08,
                  96,
                ]}
              />
              <meshBasicMaterial
                map={ringTexture ?? undefined}
                alphaMap={ringTexture ?? undefined}
                color={body.secondaryColor}
                transparent
                opacity={body.id === 'saturn' ? 0.26 : 0.08}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
          </>
        ) : null}

        {isSelectable ? (
          <mesh
            scale={body.id === 'mars' ? [3.2, 3.2, 3.2] : [2.6, 2.6, 2.6]}
            onClick={handleSelect}
            onPointerOver={(event) => {
              event.stopPropagation();
              setIsHovered(true);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              setIsHovered(false);
            }}
          >
            <sphereGeometry args={[body.size, 32, 32]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        ) : null}
      </group>
    </group>
  );
}

function DeepSpaceBackdrop() {
  return (
    <group>
      <mesh scale={[22, 22, 22]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#06101d" side={THREE.BackSide} />
      </mesh>

      <MilkyWayBand />
      <GalacticDustBand />
      <NebulaGlowLayer />
      <HeroStarLayer />

      <StarFieldLayer count={CANVAS_STAR_COUNT_NEAR + 600} radiusMin={9} radiusMax={16} size={0.034} drift={0.0046} opacity={0.9} />
      <StarFieldLayer count={1100} radiusMin={14} radiusMax={22} size={0.05} drift={-0.0018} opacity={0.72} />
      <StarFieldLayer count={CANVAS_STAR_COUNT_FAR + 500} radiusMin={21} radiusMax={31} size={0.072} drift={0.0009} opacity={0.48} />
    </group>
  );
}

function ObserverCollapseSequence({ onComplete }: { onComplete: () => void }) {
  const { camera } = useThree();
  const completeRef = useRef(false);
  const progressRef = useRef(0);
  const rootRef = useRef<THREE.Group>(null!);
  const backdropRef = useRef<THREE.Group>(null!);
  const sunRef = useRef<THREE.Mesh>(null!);
  const sunGlowRef = useRef<THREE.Sprite>(null!);
  const voidCoreRef = useRef<THREE.Mesh>(null!);
  const voidGlowRef = useRef<THREE.Sprite>(null!);
  const shardRefs = useRef<Array<THREE.Mesh | null>>([]);
  const bodyRefs = useRef<Array<THREE.Group | null>>([]);
  const surfaceRefs = useRef<Array<THREE.Mesh | null>>([]);
  const cloudRefs = useRef<Array<THREE.Mesh | null>>([]);
  const atmosphereRefs = useRef<Array<THREE.Mesh | null>>([]);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const overlayElementsRef = useRef({
    flare: null as HTMLElement | null,
    cloud: null as HTMLElement | null,
    speed: null as HTMLElement | null,
    vignette: null as HTMLElement | null,
    black: null as HTMLElement | null,
  });

  const sunSurfaceTexture = useMemo(() => createSunSurfaceTexture(), []);
  const glowTexture = useMemo(() => createGlowTexture(), []);
  const bodyAssets = useMemo(
    () => SOLAR_BODIES.map((body) => ({
      body,
      textures: createPlanetTextures(body),
      ringTexture: body.hasRing ? createRingTexture(body) : null,
      materialSettings: getSurfaceMaterialSettings(body),
      atmosphere: getAtmosphereSettings(body),
    })),
    [],
  );
  const shardConfigs = useMemo(
    () => Array.from({ length: 18 }, (_, index) => ({
      radius: 0.9 + (index % 5) * 0.34,
      phase: index * 0.46,
      y: (index - 9) * 0.11,
      size: 0.048 + (index % 3) * 0.02,
      color: index % 3 === 0 ? '#e0f2fe' : index % 2 === 0 ? '#7dd3fc' : '#fef3c7',
    })),
    [],
  );

  useEffect(() => {
    overlayElementsRef.current = {
      flare: document.getElementById('earth-dive-flare-overlay'),
      cloud: document.getElementById('earth-dive-cloud-overlay'),
      speed: document.getElementById('earth-dive-speed-overlay'),
      vignette: document.getElementById('earth-dive-vignette-overlay'),
      black: document.getElementById('earth-dive-black-overlay'),
    };

    Object.values(overlayElementsRef.current).forEach((element) => {
      if (!element) return;
      element.style.opacity = '0';
      element.style.transform = 'scale(1)';
    });

    return () => {
      Object.values(overlayElementsRef.current).forEach((element) => {
        if (!element) return;
        element.style.opacity = '0';
        element.style.transform = 'scale(1)';
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      sunSurfaceTexture.dispose();
      glowTexture.dispose();
      bodyAssets.forEach(({ textures, ringTexture }) => {
        textures.colorMap.dispose();
        textures.roughnessMap.dispose();
        textures.bumpMap.dispose();
        textures.cloudAlphaMap?.dispose();
        ringTexture?.dispose();
      });
    };
  }, [bodyAssets, glowTexture, sunSurfaceTexture]);

  useFrame((state, delta) => {
    const progress = (progressRef.current = Math.min(1, progressRef.current + delta / 4.8));
    const gatherProgress = THREE.MathUtils.smoothstep(progress, 0.04, 0.28);
    const compressProgress = THREE.MathUtils.smoothstep(progress, 0.18, 0.72);
    const singularityProgress = THREE.MathUtils.smoothstep(progress, 0.56, 0.94);
    const consumeProgress = THREE.MathUtils.smoothstep(progress, 0.82, 1);
    const elapsedTime = state.clock.getElapsedTime();

    if (rootRef.current) {
      rootRef.current.rotation.z = THREE.MathUtils.lerp(0.01, -0.08, compressProgress)
        + Math.sin(elapsedTime * 0.9) * 0.01 * (1 - consumeProgress);
      rootRef.current.position.x = Math.sin(elapsedTime * 0.34) * 0.04 * (1 - singularityProgress * 0.8);
    }

    if (backdropRef.current) {
      const scale = THREE.MathUtils.lerp(1.02, 0.2, compressProgress * 0.86 + consumeProgress * 0.14);
      backdropRef.current.scale.setScalar(scale);
      backdropRef.current.rotation.y += delta * (0.02 + gatherProgress * 0.08 + compressProgress * 0.12);
      backdropRef.current.rotation.z = THREE.MathUtils.lerp(0, -0.22, singularityProgress);
    }

    if (sunRef.current) {
      const material = sunRef.current.material as THREE.MeshBasicMaterial;
      const sunScale = THREE.MathUtils.lerp(1, 0.14, singularityProgress);
      sunRef.current.scale.setScalar(sunScale);
      material.opacity = 1 - singularityProgress * 0.96;
      material.color.setRGB(
        1 - singularityProgress * 0.7,
        0.82 - singularityProgress * 0.62,
        0.54 - singularityProgress * 0.45,
      );
    }

    if (sunGlowRef.current) {
      const material = sunGlowRef.current.material as THREE.SpriteMaterial;
      const glowScale = THREE.MathUtils.lerp(3.2, 1.1, singularityProgress);
      sunGlowRef.current.scale.set(glowScale, glowScale, 1);
      material.opacity = THREE.MathUtils.lerp(0.34, 0, singularityProgress);
    }

    if (voidCoreRef.current) {
      const material = voidCoreRef.current.material as THREE.MeshPhysicalMaterial;
      const coreScale = THREE.MathUtils.lerp(0.08, 1.24, singularityProgress);
      voidCoreRef.current.scale.setScalar(coreScale);
      voidCoreRef.current.rotation.x += delta * 0.32;
      voidCoreRef.current.rotation.y += delta * 0.54;
      material.opacity = THREE.MathUtils.lerp(0.08, 0.94, singularityProgress);
      material.emissiveIntensity = 0.16 + singularityProgress * 1.2;
    }

    if (voidGlowRef.current) {
      const material = voidGlowRef.current.material as THREE.SpriteMaterial;
      const scale = THREE.MathUtils.lerp(0.9, 4.8, singularityProgress);
      voidGlowRef.current.scale.set(scale, scale, 1);
      material.opacity = THREE.MathUtils.clamp(0.08 + singularityProgress * 0.24 - consumeProgress * 0.14, 0, 0.28);
    }

    shardConfigs.forEach((config, index) => {
      const shard = shardRefs.current[index];
      if (!shard) return;

      const angle = elapsedTime * (0.46 + index * 0.018) + config.phase + compressProgress * 6.4;
      const radius = THREE.MathUtils.lerp(config.radius, 0.1, singularityProgress);
      shard.position.set(
        Math.cos(angle) * radius,
        THREE.MathUtils.lerp(config.y, 0, singularityProgress),
        Math.sin(angle) * radius * THREE.MathUtils.lerp(1, 0.34, singularityProgress),
      );
      shard.rotation.x += delta * (0.7 + index * 0.03);
      shard.rotation.y += delta * (0.9 + index * 0.04);
      shard.scale.setScalar(THREE.MathUtils.lerp(1, 0.18, consumeProgress));

      const material = shard.material as THREE.MeshStandardMaterial;
      material.opacity = THREE.MathUtils.clamp(0.12 + gatherProgress * 0.22 - consumeProgress * 0.2, 0, 0.34);
    });

    bodyAssets.forEach(({ body, atmosphere }, index) => {
      const group = bodyRefs.current[index];
      const surface = surfaceRefs.current[index];
      const clouds = cloudRefs.current[index];
      const atmosphereMesh = atmosphereRefs.current[index];
      const ring = ringRefs.current[index];
      if (!group || !surface || !atmosphereMesh) return;

      const orbitAngle = body.phaseOffset + elapsedTime * getCompressedOrbitSpeed(body) * (1.1 + gatherProgress * 2.8);
      const orbitPosition = getOrbitalPosition(body, orbitAngle).multiplyScalar(THREE.MathUtils.lerp(1, 1.08, gatherProgress));
      const spiralAngle = orbitAngle + compressProgress * (2.8 + index * 0.34);
      const spiralRadius = THREE.MathUtils.lerp(body.semiMajorAxis, 0.16 + index * 0.014, compressProgress);
      const spiralPosition = new THREE.Vector3(
        Math.cos(spiralAngle) * spiralRadius,
        Math.sin(elapsedTime * 0.86 + index * 0.72) * 0.08 * (1 - singularityProgress),
        Math.sin(spiralAngle) * spiralRadius * THREE.MathUtils.lerp(1, 0.42, singularityProgress),
      );
      const targetPosition = new THREE.Vector3(
        Math.sin(index * 2.1) * 0.07 * (1 - consumeProgress),
        Math.cos(index * 1.4) * 0.05 * (1 - consumeProgress),
        -0.12 + index * 0.028 * (1 - consumeProgress),
      );

      group.position.copy(orbitPosition.lerp(spiralPosition.lerp(targetPosition, singularityProgress), compressProgress));
      group.rotation.z = Math.sin(elapsedTime * 0.42 + index * 0.7) * 0.12 * (1 - singularityProgress);
      group.scale.setScalar(THREE.MathUtils.lerp(1.06, 0.14, singularityProgress));

      surface.rotation.y += delta * body.rotationSpeed * (0.8 + compressProgress * 2.4);
      const surfaceMaterial = surface.material as THREE.MeshPhysicalMaterial;
      surfaceMaterial.opacity = THREE.MathUtils.clamp(1 - consumeProgress * 0.96, 0, 1);

      if (clouds) {
        clouds.rotation.y += delta * (0.14 + Math.abs(body.rotationSpeed) * 1.2);
        const cloudMaterial = clouds.material as THREE.MeshPhysicalMaterial;
        cloudMaterial.opacity = THREE.MathUtils.clamp((body.id === 'earth' ? 0.22 : 0.16) * (1 - singularityProgress * 0.72), 0, 1);
      }

      const atmosphereMaterial = atmosphereMesh.material as THREE.MeshBasicMaterial;
      atmosphereMaterial.opacity = THREE.MathUtils.clamp(atmosphere.opacity * (1 - singularityProgress * 0.82), 0, atmosphere.opacity);

      if (ring) {
        ring.rotation.z += delta * 0.12;
        const ringMaterial = ring.material as THREE.MeshBasicMaterial;
        ringMaterial.opacity = THREE.MathUtils.clamp(0.52 * (1 - singularityProgress * 0.86), 0, 0.52);
      }
    });

    const cameraTarget = new THREE.Vector3(
      THREE.MathUtils.lerp(0, 0.08, compressProgress),
      THREE.MathUtils.lerp(0.34, 0.06, singularityProgress),
      THREE.MathUtils.lerp(7.4, 3.2, singularityProgress),
    );
    camera.position.lerp(cameraTarget, 0.08);
    camera.lookAt(0, 0, 0);

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = 46 + gatherProgress * 12 - singularityProgress * 18;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.08);
      camera.updateProjectionMatrix();
    }

    const {
      flare: flareOverlay,
      cloud: cloudOverlay,
      speed: speedOverlay,
      vignette: vignetteOverlay,
      black: blackOverlay,
    } = overlayElementsRef.current;

    if (flareOverlay) {
      flareOverlay.style.opacity = '0';
      flareOverlay.style.transform = 'scale(1)';
    }

    if (cloudOverlay) {
      cloudOverlay.style.opacity = '0';
      cloudOverlay.style.transform = 'scale(1)';
    }

    if (speedOverlay) {
      const opacity = THREE.MathUtils.smoothstep(progress, 0.14, 0.78)
        * (1 - THREE.MathUtils.smoothstep(progress, 0.8, 1))
        * 0.22;
      speedOverlay.style.opacity = String(opacity);
      speedOverlay.style.transform = `scale(${THREE.MathUtils.lerp(1, 1.18, compressProgress)}, ${THREE.MathUtils.lerp(1, 0.76, singularityProgress)})`;
    }

    if (vignetteOverlay) {
      vignetteOverlay.style.opacity = String(
        THREE.MathUtils.clamp(compressProgress * 0.34 + singularityProgress * 0.42, 0, 0.82),
      );
    }

    if (blackOverlay) {
      blackOverlay.style.opacity = String(THREE.MathUtils.smoothstep(progress, 0.88, 1) * 0.88);
    }

    if (progress >= 1 && !completeRef.current) {
      completeRef.current = true;
      onComplete();
    }
  });

  return (
    <group ref={rootRef}>
      <ambientLight intensity={0.16} color="#cbd5e1" />
      <pointLight position={[0, 0, 0]} color="#ffe8b5" intensity={1.8} distance={18} decay={1.8} />
      <pointLight position={[0, 0, 0]} color="#7dd3fc" intensity={1.2} distance={12} decay={2.2} />

      <group ref={backdropRef}>
        <DeepSpaceBackdrop />
      </group>

      <mesh ref={sunRef}>
        <sphereGeometry args={[0.38, 48, 48]} />
        <meshBasicMaterial map={sunSurfaceTexture} color="#ffd08b" transparent opacity={1} toneMapped={false} />
      </mesh>

      <sprite ref={sunGlowRef} scale={[3.2, 3.2, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#ffd18a"
          transparent
          opacity={0.34}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      <mesh ref={voidCoreRef} scale={[0.08, 0.08, 0.08]}>
        <icosahedronGeometry args={[0.46, 2]} />
        <meshPhysicalMaterial
          color="#020617"
          emissive="#0f172a"
          emissiveIntensity={0.16}
          roughness={0.24}
          metalness={0.18}
          transparent
          opacity={0.08}
        />
      </mesh>

      <sprite ref={voidGlowRef} scale={[0.9, 0.9, 1]}>
        <spriteMaterial
          map={glowTexture}
          color="#7dd3fc"
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      {shardConfigs.map((config, index) => (
        <mesh
          key={`collapse-shard-${index}`}
          ref={(el) => {
            shardRefs.current[index] = el;
          }}
          position={[Math.cos(config.phase) * config.radius, config.y, Math.sin(config.phase) * config.radius]}
        >
          <octahedronGeometry args={[config.size, 0]} />
          <meshStandardMaterial
            color={config.color}
            emissive={config.color}
            emissiveIntensity={0.32}
            roughness={0.24}
            metalness={0.12}
            transparent
            opacity={0.18}
          />
        </mesh>
      ))}

      {bodyAssets.map(({ body, textures, ringTexture, materialSettings, atmosphere }, index) => (
        <group
          key={`collapse-body-${body.id}`}
          ref={(el) => {
            bodyRefs.current[index] = el;
          }}
        >
          {body.hasRing && ringTexture ? (
            <mesh
              ref={(el) => {
                ringRefs.current[index] = el;
              }}
              rotation={[THREE.MathUtils.degToRad(body.ringTiltDeg ?? 0), 0, 0]}
            >
              <ringGeometry args={[
                body.size * (body.ringInnerScale ?? 1.4),
                body.size * (body.ringOuterScale ?? 2),
                96,
              ]} />
              <meshBasicMaterial
                map={ringTexture}
                color={body.ringColor || '#f8fafc'}
                transparent
                opacity={0.52}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          ) : null}

          <mesh
            ref={(el) => {
              surfaceRefs.current[index] = el;
            }}
          >
            <sphereGeometry args={[body.size, 40, 40]} />
            <meshPhysicalMaterial
              map={textures.colorMap}
              roughnessMap={textures.roughnessMap}
              bumpMap={textures.bumpMap}
              bumpScale={materialSettings.bumpScale}
              roughness={materialSettings.roughness}
              clearcoat={materialSettings.clearcoat}
              clearcoatRoughness={materialSettings.clearcoatRoughness}
              metalness={0.04}
              color="#ffffff"
              transparent
              opacity={1}
            />
          </mesh>

          {textures.cloudAlphaMap ? (
            <mesh
              ref={(el) => {
                cloudRefs.current[index] = el;
              }}
              scale={[1.03, 1.03, 1.03]}
            >
              <sphereGeometry args={[body.size, 32, 32]} />
              <meshPhysicalMaterial
                alphaMap={textures.cloudAlphaMap}
                color={body.id === 'earth' ? '#f8fbff' : '#fff7d4'}
                transparent
                opacity={body.id === 'earth' ? 0.22 : 0.16}
                depthWrite={false}
                roughness={0.24}
                metalness={0}
                clearcoat={0.8}
                clearcoatRoughness={0.24}
              />
            </mesh>
          ) : null}

          <mesh
            ref={(el) => {
              atmosphereRefs.current[index] = el;
            }}
            scale={[atmosphere.scale, atmosphere.scale, atmosphere.scale]}
          >
            <sphereGeometry args={[body.size, 24, 24]} />
            <meshBasicMaterial
              color={atmosphere.color}
              transparent
              opacity={atmosphere.opacity}
              side={THREE.BackSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SolarSystem3D({ onStartCollapse, onStartTarotCollapse }: { onStartCollapse: () => void; onStartTarotCollapse: () => void }) {
  const poseLandmarks = useAppStore((s) => s.poseLandmarks);
  const rootRef = useRef<THREE.Group>(null!);
  const orbitRef = useRef<THREE.Group>(null!);
  const motionRef = useRef<SolarControls>(DEFAULT_SOLAR_CONTROLS);

  useFrame((state, delta) => {
    if (!rootRef.current) return;

    // Safety check to recover from any NaN values
    if (
      isNaN(motionRef.current.expansion) || !isFinite(motionRef.current.expansion) ||
      isNaN(motionRef.current.rotationSpeed) || !isFinite(motionRef.current.rotationSpeed) ||
      isNaN(motionRef.current.tilt) || !isFinite(motionRef.current.tilt) ||
      isNaN(motionRef.current.timeScale) || !isFinite(motionRef.current.timeScale) ||
      isNaN(motionRef.current.cameraLift) || !isFinite(motionRef.current.cameraLift)
    ) {
      motionRef.current = { ...DEFAULT_SOLAR_CONTROLS };
    }

    const current = getPoseControls(poseLandmarks);
    motionRef.current.expansion = THREE.MathUtils.lerp(motionRef.current.expansion, current.expansion, 0.06);
    motionRef.current.rotationSpeed = THREE.MathUtils.lerp(motionRef.current.rotationSpeed, current.rotationSpeed, 0.08);
    motionRef.current.tilt = THREE.MathUtils.lerp(motionRef.current.tilt, current.tilt, 0.08);
    motionRef.current.timeScale = THREE.MathUtils.lerp(motionRef.current.timeScale, current.timeScale, 0.06);
    motionRef.current.cameraLift = THREE.MathUtils.lerp(motionRef.current.cameraLift, current.cameraLift, 0.05);

    rootRef.current.position.y = 0.15 + motionRef.current.cameraLift;
    rootRef.current.rotation.z = motionRef.current.tilt * 0.55;
    rootRef.current.rotation.y += delta * 0.05 * (0.6 + motionRef.current.rotationSpeed * 0.35);

    rootRef.current.rotation.x = THREE.MathUtils.lerp(
      rootRef.current.rotation.x,
      0.64 + -state.pointer.y * 0.2,
      0.04,
    );

    if (orbitRef.current) {
      orbitRef.current.scale.setScalar(motionRef.current.expansion);
    }
  });

  return (
    <group ref={rootRef}>
      <hemisphereLight color="#bfdbfe" groundColor="#082f49" intensity={0.24} />
      <directionalLight position={[5.5, 2.4, 3.8]} intensity={0.24} color="#bfdbfe" />
      <DeepSpaceBackdrop />
      <SolarSun />

      <group ref={orbitRef}>
        {SOLAR_BODIES.map((body) => (
          <OrbitPath3D key={`${body.id}-orbit`} body={body} />
        ))}

        <AsteroidBelt motionRef={motionRef} />

        {SOLAR_BODIES.map((body) => (
          <SolarPlanet
            key={body.id}
            body={body}
            motionRef={motionRef}
            onSelect={body.id === 'earth' ? onStartCollapse : body.id === 'mars' ? onStartTarotCollapse : undefined}
          />
        ))}
      </group>
    </group>
  );
}

function SceneCameraRig({ stage, standbyMode }: { stage: string; standbyMode: StandbySceneMode }) {
  const { camera } = useThree();

  useFrame(() => {
    if (stage === 'STANDBY' && standbyMode === 'collapse') {
      return;
    }

    const targetPosition = stage === 'STANDBY'
      ? new THREE.Vector3(0, 0.36, 7.5)
      : stage === 'QUESTIONING'
        ? new THREE.Vector3(0, 0.05, 4.2)
        : new THREE.Vector3(0, 0, 4);
    const targetFov = stage === 'STANDBY' ? 46 : 60;

    camera.position.lerp(targetPosition, 0.06);
    camera.lookAt(0, stage === 'STANDBY' ? 0.2 : 0, 0);

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.08);
    }

    camera.updateProjectionMatrix();
  });

  return null;
}

function BackgroundFace() {
  const voicePreset = useAppStore((s) => s.voicePreset);
  const isSpeaking = useAppStore((s) => s.isMirrorSpeaking);
  const maskKey = resolveMaskKey(VOICE_MASK_MAP[voicePreset] || 'Crystal');

  return (
    <group position={[0, 0.95, 0]} scale={[0.82, 0.82, 0.82]}>
      <ambientLight intensity={0.5} />
      <pointLight position={[5, 5, 5]} intensity={1.5} />
      <ScenePreset maskKey={maskKey} isSpeaking={isSpeaking} />
    </group>
  );
}

function GenerativeSceneFallback({
  stage,
  standbyMode,
  onStartCollapse,
  onStartTarotCollapse,
  maskBaseType,
  isMirrorSpeaking,
  webglMessage,
}: {
  stage: string;
  standbyMode: StandbySceneMode;
  onStartCollapse: () => void;
  onStartTarotCollapse: () => void;
  maskBaseType: VisualArchetype['baseType'];
  isMirrorSpeaking: boolean;
  webglMessage?: string;
}) {
  const isStandby = stage === 'STANDBY';
  const isCollapse = isStandby && standbyMode === 'collapse';

  return (
    <div className={`webgl-fallback-scene webgl-fallback-scene--${stage.toLowerCase()}${isCollapse ? ' webgl-fallback-scene--dive' : ''}`}>
      <div className="webgl-fallback-scene__nebula webgl-fallback-scene__nebula--left" />
      <div className="webgl-fallback-scene__nebula webgl-fallback-scene__nebula--right" />
      <div className="webgl-fallback-scene__stars" />

      {isStandby ? (
        <div className="webgl-fallback-scene__entry-wrap">
          <div className={`webgl-fallback-solar-system${isCollapse ? ' webgl-fallback-solar-system--dive' : ''}`}>
            <span className="webgl-fallback-solar-system__depth-haze webgl-fallback-solar-system__depth-haze--rear" />
            <span className="webgl-fallback-solar-system__sun" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--mercury" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--venus" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--earth" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--mars" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--jupiter" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--saturn" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--uranus" />
            <span className="webgl-fallback-solar-system__orbit webgl-fallback-solar-system__orbit--neptune" />

            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--mercury">
              <span className="webgl-fallback-planet webgl-fallback-planet--mercury" />
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--venus">
              <span className="webgl-fallback-planet webgl-fallback-planet--venus" />
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--earth">
              <button
                className={`webgl-fallback-entry${isCollapse ? ' webgl-fallback-entry--dive' : ''}`}
                type="button"
                onClick={onStartCollapse}
                disabled={isCollapse}
                aria-label={isCollapse ? '兼容模式坍缩中' : '点击地球触发坍缩'}
              >
                <span className="webgl-fallback-entry__halo" />
                <span className="webgl-fallback-entry__orbit" />
                <span className="webgl-fallback-entry__planet" />
                <span className="webgl-fallback-entry__atmosphere" />
                <span className="webgl-fallback-entry__cloud-band" />
              </button>
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--mars">
              <button
                className={`webgl-fallback-entry webgl-fallback-entry--mars${isCollapse ? ' webgl-fallback-entry--dive' : ''}`}
                type="button"
                onClick={onStartTarotCollapse}
                disabled={isCollapse}
                aria-label={isCollapse ? '坍缩中' : '点击火星进入塔罗'}
              >
                <span className="webgl-fallback-planet webgl-fallback-planet--mars" />
              </button>
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--jupiter">
              <span className="webgl-fallback-planet webgl-fallback-planet--jupiter" />
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--saturn">
              <span className="webgl-fallback-planet webgl-fallback-planet--saturn" />
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--uranus">
              <span className="webgl-fallback-planet webgl-fallback-planet--uranus" />
            </div>
            <div className="webgl-fallback-solar-system__orbiter webgl-fallback-solar-system__orbiter--neptune">
              <span className="webgl-fallback-planet webgl-fallback-planet--neptune" />
            </div>
            <span className="webgl-fallback-solar-system__depth-haze webgl-fallback-solar-system__depth-haze--front" />
          </div>
          <div className={`webgl-fallback-dive-cinematic${isCollapse ? ' webgl-fallback-dive-cinematic--active' : ''}`} aria-hidden="true">
            <span className="webgl-fallback-dive-cinematic__vignette" />
            <span className="webgl-fallback-dive-cinematic__flare" />
            <span className="webgl-fallback-dive-cinematic__clouds" />
            <span className="webgl-fallback-dive-cinematic__horizon" />
          </div>
          <p className="webgl-fallback-scene__caption">
            {isCollapse ? '兼容模式坍缩中…' : '点击地球触发坍缩'}
          </p>
        </div>
      ) : stage === 'QUESTIONING' ? (
        <div className="webgl-fallback-scene__mask-shell">
          <MirrorFaceFallback baseType={maskBaseType} isSpeaking={isMirrorSpeaking} />
        </div>
      ) : (
        <div className="webgl-fallback-scene__core" />
      )}

      <p className="webgl-fallback-scene__notice">WebGL 不可用，已自动切换到兼容模式。</p>
      {webglMessage ? <p className="webgl-fallback-scene__diagnostic">{webglMessage}</p> : null}
    </div>
  );
}

export function GenerativeScene() {
  const currentStage = useAppStore((s) => s.currentStage);
  const smileScore = useAppStore((s) => s.cvData.smileScore);
  const faceLandmarks = useAppStore((s) => s.faceLandmarks);
  const voicePreset = useAppStore((s) => s.voicePreset);
  const isMirrorSpeaking = useAppStore((s) => s.isMirrorSpeaking);
  const setStage = useAppStore((s) => s.setStage);
  const recordScanStart = useAppStore((s) => s.recordScanStart);
  const [eventSrc, setEventSrc] = useState<HTMLElement | undefined>(undefined);
  const [standbyMode, setStandbyMode] = useState<StandbySceneMode>('solar');
  const [collapseDestination, setCollapseDestination] = useState<CollapseDestination>('QUESTIONING');
  const [webglSupportDetails, setWebglSupportDetails] = useState<WebGLSupportDetails>(() => getWebGLSupportDetails());
  const [webglAvailable, setWebglAvailable] = useState(() => webglSupportDetails.supported);

  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      setEventSrc(rootEl);
    }
  }, []);

  useEffect(() => {
    if (currentStage !== 'STANDBY') {
      setStandbyMode('solar');
    }
  }, [currentStage]);

  const handleCollapseStart = useCallback((destination: CollapseDestination = 'QUESTIONING') => {
    if (currentStage !== 'STANDBY' || standbyMode === 'collapse') {
      return;
    }

    setCollapseDestination(destination);
    recordScanStart();
    startTransition(() => {
      setStandbyMode('collapse');
    });
  }, [currentStage, recordScanStart, standbyMode]);

  const handleCollapseComplete = useCallback(() => {
    startTransition(() => {
      setStandbyMode('solar');
      setStage(collapseDestination);
    });
  }, [collapseDestination, setStage]);

  const handleWebGLFallback = useCallback((details: WebGLSupportDetails) => {
    setWebglSupportDetails(details);
    setWebglAvailable(false);
  }, []);

  useEffect(() => {
    if (webglAvailable || currentStage !== 'STANDBY' || standbyMode !== 'collapse') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      handleCollapseComplete();
    }, 1900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentStage, handleCollapseComplete, standbyMode, webglAvailable]);

  const isCollapse = currentStage === 'STANDBY' && standbyMode === 'collapse';
  const hasTrackedFace = Boolean(faceLandmarks && faceLandmarks.length >= 468);
  const maskBaseType = VOICE_MASK_MAP[voicePreset] || 'Crystal';
  const bloomIntensity = currentStage === 'STANDBY'
    ? isCollapse
      ? 0.94
      : 1.08
    : 0.8 + smileScore * 2.0;
  const bloomThreshold = isCollapse ? 0.24 : 0.2;
  const bloomSmoothing = isCollapse ? 0.82 : 0.9;
  const sceneFallback = (
    <GenerativeSceneFallback
      stage={currentStage}
      standbyMode={standbyMode}
      onStartCollapse={() => handleCollapseStart('QUESTIONING')}
      onStartTarotCollapse={() => handleCollapseStart('TAROT')}
      maskBaseType={maskBaseType}
      isMirrorSpeaking={isMirrorSpeaking}
      webglMessage={!webglAvailable ? webglSupportDetails.message : undefined}
    />
  );
  const containerClassName = `three-canvas-container${!webglAvailable && currentStage === 'STANDBY' ? ' three-canvas-container--webgl-standby' : ''}`;

  return (
    <div className={containerClassName}>
      <WebGLCanvasGuard fallback={sceneFallback} onFallback={handleWebGLFallback}>
        <Canvas
          camera={{ position: [0, 0, 4], fov: 60 }}
          gl={(canvas) => createBestEffortWebGLRenderer(canvas as HTMLCanvasElement)}
          dpr={[1, 1.5]}
          eventSource={eventSrc || undefined}
        >
          <SceneCameraRig stage={currentStage} standbyMode={standbyMode} />
          <ambientLight intensity={0.1} />
          <NoiseBackground />

          {currentStage === 'QUESTIONING' ? (
            hasTrackedFace ? null : <BackgroundFace />
          ) : currentStage === 'STANDBY' ? (
            standbyMode === 'collapse' ? (
              <ObserverCollapseSequence onComplete={handleCollapseComplete} />
            ) : (
              <SolarSystem3D
                onStartCollapse={() => handleCollapseStart('QUESTIONING')}
                onStartTarotCollapse={() => handleCollapseStart('TAROT')}
              />
            )
          ) : (
            <ParticleSphere />
          )}

          <EffectComposer>
            <Bloom
              intensity={bloomIntensity}
              luminanceThreshold={bloomThreshold}
              luminanceSmoothing={bloomSmoothing}
              mipmapBlur={!isCollapse}
            />
          </EffectComposer>
        </Canvas>
      </WebGLCanvasGuard>
      {webglAvailable && isCollapse && (
        <>
          <div id="earth-dive-flare-overlay" className="earth-dive-flare-overlay" />
          <div id="earth-dive-speed-overlay" className="earth-dive-speed-overlay" />
          <div id="earth-dive-cloud-overlay" className="earth-dive-cloud-overlay" />
          <div id="earth-dive-vignette-overlay" className="earth-dive-vignette-overlay" />
          <div id="earth-dive-black-overlay" className="earth-dive-black-overlay" />
        </>
      )}
    </div>
  );
}