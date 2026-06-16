/**
 * 人形粒子扫描效果
 * 利用 PoseLandmarks 生成人体轮廓，粒子从上到下填充
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getShaderPreset } from '../../shaders';
import type { CVFeatures, VisualArchetype } from '../../types';

// MediaPipe Pose 骨骼连接关系 (用于构建人形轮廓)
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],   // 头部右侧
  [0, 4], [4, 5], [5, 6], [6, 8],   // 头部左侧
  [9, 10],                            // 嘴
  [11, 12],                           // 肩膀
  [11, 13], [13, 15],                // 左臂
  [12, 14], [14, 16],                // 右臂
  [11, 23], [12, 24],                // 躯干
  [23, 24],                           // 臀部
  [23, 25], [25, 27],                // 左腿
  [24, 26], [26, 28],                // 右腿
  [15, 17], [15, 19], [17, 19],      // 左手
  [16, 18], [16, 20], [18, 20],      // 右手
  [27, 29], [29, 31],                // 左脚
  [28, 30], [30, 32],                // 右脚
];

const FACE_OVAL_LOOP = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

// 人体轮廓索引 (按顺序构成外轮廓)
const BODY_OUTLINE = [
  // 头顶 -> 右肩 -> 右手 -> 右脚 -> 左脚 -> 左手 -> 左肩 -> 头顶
  0, 4, 5, 6, 8,  // 头顶到左耳
  12, 14, 16, 20, 18, 16, 14, 12, // 右臂
  24, 26, 28, 32, 30, 28, 26, 24, // 右腿
  23, 25, 27, 31, 29, 27, 25, 23, // 左腿
  11, 13, 15, 19, 17, 15, 13, 11, // 左臂
  0, 1, 2, 3, 7, // 头顶到右耳
];

const BODY_FILL_SILHOUETTE = [
  0, 7, 11, 13, 15, 19, 17, 15, 23, 25, 27, 29, 31,
  32, 30, 28, 26, 24, 16, 18, 20, 16, 14, 12, 8,
];

const POSE_CONNECTION_DENSITY = 12;
const BODY_OUTLINE_DENSITY = 10;
const BODY_SILHOUETTE_FILL_COUNT = 420;
const TORSO_FILL_COUNT = 320;
const NECK_FILL_COUNT = 96;
const HEAD_SHELL_SAMPLES = 72;
const HEAD_FILL_COUNT = 140;
const FACE_OUTLINE_DENSITY = 24;
const FACE_FILL_COUNT = 120;
const FACE_SHELL_SAMPLES = 84;
const FACE_SHELL_FILL_COUNT = 72;
const LIMB_FILL_COUNTS = {
  upperArm: 90,
  forearm: 76,
  thigh: 120,
  calf: 104,
  foot: 36,
  heel: 28,
} as const;
const MAX_POSE_PARTICLES = 2200;
const MAX_FACE_PARTICLES = 720;

interface Particle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  born: number; // 出生时间 (相对于扫描线位置)
  active: boolean;
}

type ParticleMode = 'pose' | 'face' | 'hybrid' | null;

interface CanvasPoint {
  x: number;
  y: number;
}

interface ScanParticleProfile {
  primaryColor: string;
  secondaryColor: string;
  densityScale: number;
  fillScale: number;
  spreadScale: number;
  sizeScale: number;
  spawnScale: number;
  spring: number;
  damping: number;
  bodyAlpha: number;
  detailAlpha: number;
  shadowBlur: number;
  scanDuration: number;
  beamAlpha: number;
  skeletonAlpha: number;
  outlineAlpha: number;
}

function derivePreviewArchetype(cvData: CVFeatures): VisualArchetype {
  let baseType: 'Crystal' | 'Nebula' | 'Plasma' | 'Flora' | 'Singularity' = 'Crystal';

  if (cvData.smileScore > 0.68 && cvData.opennessScore > 0.52) {
    baseType = 'Flora';
  } else if (cvData.movementScore > 0.6) {
    baseType = 'Plasma';
  } else if (cvData.attentionScore > 0.7) {
    baseType = 'Crystal';
  } else if (cvData.movementScore < 0.32 && cvData.attentionScore < 0.46) {
    baseType = 'Nebula';
  } else if (cvData.smileScore < 0.24 && cvData.opennessScore < 0.28) {
    baseType = 'Singularity';
  }

  let modifierType: 'Static' | 'Volatile' | 'Resonant' | 'Drifting' = 'Static';
  if (cvData.movementScore > 0.6) modifierType = 'Volatile';
  else if (cvData.attentionScore > 0.7) modifierType = 'Resonant';
  else if (cvData.movementScore < 0.3 && cvData.attentionScore < 0.4) modifierType = 'Drifting';

  return {
    id: 'preview',
    name: '扫描中...',
    dimensions: { capital: 0, spirit: 0, intellect: 0, social: 0, order: 0, energy: 0 },
    color: '#ffffff',
    description: '正在扫描您的特征...',
    baseType,
    modifierType,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function toRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function scaleParticleCount(count: number, densityScale: number) {
  return Math.max(1, Math.round(count * densityScale));
}

function limitParticles(particles: Particle[], maxCount: number) {
  if (particles.length <= maxCount) return particles;

  const stride = Math.ceil(particles.length / maxCount);
  return particles.filter((_, index) => index % stride === 0).slice(0, maxCount);
}

function scaleParticleOptions(
  profile: ScanParticleProfile,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  return {
    spread: (options.spread ?? 2) * profile.spreadScale,
    sizeMin: (options.sizeMin ?? 1.2) * profile.sizeScale,
    sizeMax: (options.sizeMax ?? 2.4) * profile.sizeScale,
    localSpawn: (options.localSpawn ?? 48) * profile.spawnScale,
    bornOffset: options.bornOffset ?? 0.2,
  };
}

function getScanParticleProfile(archetype: VisualArchetype): ScanParticleProfile {
  const preset = getShaderPreset(archetype.baseType);

  const baseProfiles: Record<VisualArchetype['baseType'], Omit<ScanParticleProfile, 'primaryColor' | 'secondaryColor'>> = {
    Crystal: {
      densityScale: 0.92,
      fillScale: 0.92,
      spreadScale: 0.88,
      sizeScale: 0.95,
      spawnScale: 0.9,
      spring: 0.034,
      damping: 0.9,
      bodyAlpha: 0.5,
      detailAlpha: 0.76,
      shadowBlur: 10,
      scanDuration: 4.4,
      beamAlpha: 0.72,
      skeletonAlpha: 0.16,
      outlineAlpha: 0.24,
    },
    Nebula: {
      densityScale: 1,
      fillScale: 1,
      spreadScale: 1.18,
      sizeScale: 1.04,
      spawnScale: 1.08,
      spring: 0.028,
      damping: 0.92,
      bodyAlpha: 0.46,
      detailAlpha: 0.7,
      shadowBlur: 16,
      scanDuration: 5,
      beamAlpha: 0.6,
      skeletonAlpha: 0.14,
      outlineAlpha: 0.22,
    },
    Plasma: {
      densityScale: 1.08,
      fillScale: 1.08,
      spreadScale: 1.2,
      sizeScale: 1.08,
      spawnScale: 1.05,
      spring: 0.05,
      damping: 0.84,
      bodyAlpha: 0.6,
      detailAlpha: 0.84,
      shadowBlur: 18,
      scanDuration: 3.2,
      beamAlpha: 0.9,
      skeletonAlpha: 0.2,
      outlineAlpha: 0.3,
    },
    Flora: {
      densityScale: 1.02,
      fillScale: 1.02,
      spreadScale: 0.96,
      sizeScale: 1.14,
      spawnScale: 1,
      spring: 0.036,
      damping: 0.89,
      bodyAlpha: 0.54,
      detailAlpha: 0.8,
      shadowBlur: 13,
      scanDuration: 4.2,
      beamAlpha: 0.74,
      skeletonAlpha: 0.17,
      outlineAlpha: 0.25,
    },
    Singularity: {
      densityScale: 0.78,
      fillScale: 0.78,
      spreadScale: 1.3,
      sizeScale: 0.92,
      spawnScale: 1.18,
      spring: 0.026,
      damping: 0.93,
      bodyAlpha: 0.64,
      detailAlpha: 0.88,
      shadowBlur: 20,
      scanDuration: 5.8,
      beamAlpha: 0.56,
      skeletonAlpha: 0.18,
      outlineAlpha: 0.28,
    },
  };

  const profile: ScanParticleProfile = {
    primaryColor: preset.colors[0],
    secondaryColor: preset.colors[1],
    ...baseProfiles[archetype.baseType],
  };

  if (archetype.baseType === 'Singularity') {
    profile.primaryColor = '#f4fbff';
    profile.secondaryColor = '#93b2c7';
  }

  switch (archetype.modifierType) {
    case 'Volatile':
      profile.densityScale *= 1.12;
      profile.fillScale *= 1.12;
      profile.spreadScale *= 1.12;
      profile.spring *= 1.18;
      profile.damping *= 0.95;
      profile.shadowBlur += 2;
      profile.scanDuration *= 0.82;
      break;
    case 'Resonant':
      profile.sizeScale *= 1.08;
      profile.detailAlpha = clamp(profile.detailAlpha + 0.08, 0, 0.95);
      profile.outlineAlpha = clamp(profile.outlineAlpha + 0.05, 0, 0.95);
      profile.beamAlpha = clamp(profile.beamAlpha + 0.08, 0, 0.95);
      profile.shadowBlur += 3;
      break;
    case 'Drifting':
      profile.densityScale *= 0.9;
      profile.fillScale *= 0.9;
      profile.spreadScale *= 1.18;
      profile.spawnScale *= 1.12;
      profile.spring *= 0.82;
      profile.damping = clamp(profile.damping + 0.03, 0, 0.95);
      profile.scanDuration *= 1.18;
      break;
    case 'Static':
    default:
      profile.densityScale *= 0.95;
      profile.fillScale *= 0.95;
      profile.spring *= 0.9;
      profile.damping = clamp(profile.damping + 0.02, 0, 0.95);
      profile.beamAlpha = clamp(profile.beamAlpha - 0.08, 0, 0.95);
      break;
  }

  return profile;
}

function pushTargetParticle(
  particles: Particle[],
  _width: number,
  height: number,
  targetX: number,
  targetY: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  const spread = options.spread ?? 2;
  const sizeMin = options.sizeMin ?? 1.2;
  const sizeMax = options.sizeMax ?? 2.4;
  const localSpawn = options.localSpawn ?? 48;
  const bornOffset = options.bornOffset ?? 0.2;

  particles.push({
    x: targetX + (Math.random() - 0.5) * localSpawn,
    y: targetY - 40 - Math.random() * 120,
    targetX: targetX + (Math.random() - 0.5) * spread,
    targetY: targetY + (Math.random() - 0.5) * spread,
    vx: 0,
    vy: 0,
    size: sizeMin + Math.random() * (sizeMax - sizeMin),
    alpha: 0,
    born: Math.max(0, targetY / height - bornOffset),
    active: false,
  });
}

function sampleLoopParticles(
  particles: Particle[],
  landmarks: number[][],
  indices: number[],
  width: number,
  height: number,
  density: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  for (let segmentIndex = 0; segmentIndex < indices.length - 1; segmentIndex++) {
    const startIndex = indices[segmentIndex];
    const endIndex = indices[segmentIndex + 1];
    if (startIndex >= landmarks.length || endIndex >= landmarks.length) continue;

    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    const startX = start[0] * width;
    const startY = start[1] * height;
    const endX = end[0] * width;
    const endY = end[1] * height;

    for (let step = 0; step <= density; step++) {
      const t = step / density;
      const targetX = startX + (endX - startX) * t;
      const targetY = startY + (endY - startY) * t;
      pushTargetParticle(particles, width, height, targetX, targetY, options);
    }
  }
}


function sampleArcParticles(
  particles: Particle[],
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  samples: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex++) {
    const t = sampleIndex / samples;
    const angle = Math.PI - Math.PI * t;
    const targetX = centerX + Math.cos(angle) * radiusX;
    const targetY = centerY - Math.sin(angle) * radiusY;
    pushTargetParticle(particles, width, height, targetX, targetY, options);
  }
}

function getCanvasPoint(
  landmarks: number[][],
  index: number,
  width: number,
  height: number
): CanvasPoint | null {
  if (index >= landmarks.length) return null;

  return {
    x: landmarks[index][0] * width,
    y: landmarks[index][1] * height,
  };
}

function getPointDistance(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function sampleTriangleParticles(
  particles: Particle[],
  width: number,
  height: number,
  a: CanvasPoint,
  b: CanvasPoint,
  c: CanvasPoint,
  count: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);
    const u = 1 - sqrtR1;
    const v = sqrtR1 * (1 - r2);
    const w = sqrtR1 * r2;
    const targetX = a.x * u + b.x * v + c.x * w;
    const targetY = a.y * u + b.y * v + c.y * w;
    pushTargetParticle(particles, width, height, targetX, targetY, options);
  }
}

function sampleQuadParticles(
  particles: Particle[],
  width: number,
  height: number,
  a: CanvasPoint,
  b: CanvasPoint,
  c: CanvasPoint,
  d: CanvasPoint,
  count: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  const firstHalf = Math.ceil(count / 2);
  const secondHalf = Math.floor(count / 2);
  sampleTriangleParticles(particles, width, height, a, b, c, firstHalf, options);
  sampleTriangleParticles(particles, width, height, a, c, d, secondHalf, options);
}

function sampleSegmentBandParticles(
  particles: Particle[],
  width: number,
  height: number,
  start: CanvasPoint,
  end: CanvasPoint,
  count: number,
  radius: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;

  const tangentX = dx / length;
  const tangentY = dy / length;
  const normalX = -tangentY;
  const normalY = tangentX;

  for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
    const t = Math.random();
    const lateralOffset = (Math.random() * 2 - 1) * radius * Math.sqrt(Math.random());
    const alongOffset = (Math.random() - 0.5) * radius * 0.35;
    const targetX = start.x + dx * t + normalX * lateralOffset + tangentX * alongOffset;
    const targetY = start.y + dy * t + normalY * lateralOffset + tangentY * alongOffset;
    pushTargetParticle(particles, width, height, targetX, targetY, options);
  }
}

function sampleEllipseFillParticles(
  particles: Particle[],
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  count: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const targetX = centerX + Math.cos(angle) * radiusX * radius;
    const targetY = centerY + Math.sin(angle) * radiusY * radius;
    pushTargetParticle(particles, width, height, targetX, targetY, options);
  }
}

function getPolygonBounds(points: CanvasPoint[]) {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );
}

function isPointInsidePolygon(point: CanvasPoint, polygon: CanvasPoint[]) {
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex++) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const intersects =
      (current.y > point.y) !== (previous.y > point.y)
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / ((previous.y - current.y) || 1e-6) + current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function samplePolygonFillParticles(
  particles: Particle[],
  width: number,
  height: number,
  polygon: CanvasPoint[],
  count: number,
  options: {
    spread?: number;
    sizeMin?: number;
    sizeMax?: number;
    localSpawn?: number;
    bornOffset?: number;
  } = {}
) {
  if (polygon.length < 3) return;

  const bounds = getPolygonBounds(polygon);
  const maxAttempts = Math.max(count * 8, 240);
  let accepted = 0;

  for (let attempt = 0; attempt < maxAttempts && accepted < count; attempt++) {
    const targetX = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const targetY = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
    if (!isPointInsidePolygon({ x: targetX, y: targetY }, polygon)) continue;
    pushTargetParticle(particles, width, height, targetX, targetY, options);
    accepted += 1;
  }
}

function getOutlinePolygon(
  landmarks: number[][],
  indices: number[],
  width: number,
  height: number
) {
  const polygon: CanvasPoint[] = [];

  for (const index of indices) {
    const point = getCanvasPoint(landmarks, index, width, height);
    if (!point) continue;

    const previous = polygon[polygon.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) {
      continue;
    }

    polygon.push(point);
  }

  if (polygon.length >= 2) {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5) {
      polygon.pop();
    }
  }

  return polygon;
}

export function BodyScanCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const scanLineRef = useRef(0); // 0~1 扫描线位置
  const animFrameRef = useRef(0);
  const startTimeRef = useRef(Date.now());
  const particleModeRef = useRef<ParticleMode>(null);
  const faceLandmarksRef = useRef<number[][] | null>(null);
  const poseLandmarksRef = useRef<number[][] | null>(null);

  const faceLandmarks = useAppStore((s) => s.faceLandmarks);
  const poseLandmarks = useAppStore((s) => s.poseLandmarks);
  const cvData = useAppStore((s) => s.cvData);
  const calculatedArchetype = useAppStore((s) => s.calculatedArchetype);
  const currentStage = useAppStore((s) => s.currentStage);

  const scanArchetype = useMemo(
    () => calculatedArchetype ?? derivePreviewArchetype(cvData),
    [calculatedArchetype, cvData]
  );
  const scanProfile = useMemo(
    () => getScanParticleProfile(scanArchetype),
    [scanArchetype]
  );
  const scanProfileRef = useRef(scanProfile);

  useEffect(() => {
    faceLandmarksRef.current = faceLandmarks;
  }, [faceLandmarks]);

  // 同步 pose 到 ref (避免动画循环依赖 state)
  useEffect(() => {
    poseLandmarksRef.current = poseLandmarks;
  }, [poseLandmarks]);

  useEffect(() => {
    scanProfileRef.current = scanProfile;
  }, [scanProfile]);

  // 从骨骼连接线上生成散布粒子
  const generateParticlesFromPose = useCallback(
    (landmarks: number[][], width: number, height: number) => {
      const particles: Particle[] = [];
      const density = scaleParticleCount(POSE_CONNECTION_DENSITY, scanProfile.densityScale); // 每段连接生成的粒子数
      const bodyOutlineLoop = [...BODY_OUTLINE, BODY_OUTLINE[0]];
      const silhouettePolygon = getOutlinePolygon(landmarks, BODY_FILL_SILHOUETTE, width, height);
      const nose = getCanvasPoint(landmarks, 0, width, height);
      const leftEar = getCanvasPoint(landmarks, 7, width, height);
      const rightEar = getCanvasPoint(landmarks, 8, width, height);
      const leftShoulder = getCanvasPoint(landmarks, 11, width, height);
      const rightShoulder = getCanvasPoint(landmarks, 12, width, height);
      const leftElbow = getCanvasPoint(landmarks, 13, width, height);
      const rightElbow = getCanvasPoint(landmarks, 14, width, height);
      const leftWrist = getCanvasPoint(landmarks, 15, width, height);
      const rightWrist = getCanvasPoint(landmarks, 16, width, height);
      const leftHip = getCanvasPoint(landmarks, 23, width, height);
      const rightHip = getCanvasPoint(landmarks, 24, width, height);
      const leftKnee = getCanvasPoint(landmarks, 25, width, height);
      const rightKnee = getCanvasPoint(landmarks, 26, width, height);
      const leftAnkle = getCanvasPoint(landmarks, 27, width, height);
      const rightAnkle = getCanvasPoint(landmarks, 28, width, height);
      const leftHeel = getCanvasPoint(landmarks, 29, width, height);
      const rightHeel = getCanvasPoint(landmarks, 30, width, height);
      const leftFoot = getCanvasPoint(landmarks, 31, width, height);
      const rightFoot = getCanvasPoint(landmarks, 32, width, height);

      const shoulderSpan = leftShoulder && rightShoulder ? getPointDistance(leftShoulder, rightShoulder) : width * 0.14;
      const hipSpan = leftHip && rightHip ? getPointDistance(leftHip, rightHip) : shoulderSpan * 0.92;
      const bodySpan = Math.max(shoulderSpan, hipSpan, width * 0.08);

      if (silhouettePolygon.length >= 3) {
        samplePolygonFillParticles(
          particles,
          width,
          height,
          silhouettePolygon,
          scaleParticleCount(BODY_SILHOUETTE_FILL_COUNT, scanProfile.fillScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.8,
            sizeMin: 0.95,
            sizeMax: 2.5,
            localSpawn: 28,
            bornOffset: 0.12,
          })
        );
      }

      sampleLoopParticles(
        particles,
        landmarks,
        bodyOutlineLoop,
        width,
        height,
        scaleParticleCount(BODY_OUTLINE_DENSITY, scanProfile.densityScale),
        scaleParticleOptions(scanProfile, {
          spread: 6,
          sizeMin: 1.3,
          sizeMax: 2.9,
          localSpawn: 36,
          bornOffset: 0.14,
        })
      );

      for (const [i, j] of POSE_CONNECTIONS) {
        if (i >= landmarks.length || j >= landmarks.length) continue;

        const x1 = landmarks[i][0] * width;
        const y1 = landmarks[i][1] * height;
        const x2 = landmarks[j][0] * width;
        const y2 = landmarks[j][1] * height;

        for (let k = 0; k <= density; k++) {
          const t = k / density;
          const tx = x1 + (x2 - x1) * t;
          const ty = y1 + (y2 - y1) * t;

          // 添加随机偏移让粒子不完全在骨骼线上
          const spread = (9 + Math.random() * 16) * scanProfile.spreadScale;
          const angle = Math.random() * Math.PI * 2;

          particles.push({
            x: tx + (Math.random() * width * 0.3 - width * 0.15) * scanProfile.spawnScale, // 初始随机位置
            y: Math.random() * height, // 初始随机高度
            targetX: tx + Math.cos(angle) * spread,
            targetY: ty + Math.sin(angle) * spread,
            vx: 0,
            vy: 0,
            size: (0.9 + Math.random() * 2.2) * scanProfile.sizeScale,
            alpha: 0,
            born: Math.max(0, ty / height - 0.03), // 根据目标 y 位置决定何时激活
            active: false,
          });
        }
      }

      if (leftShoulder && rightShoulder && rightHip && leftHip) {
        sampleQuadParticles(
          particles,
          width,
          height,
          leftShoulder,
          rightShoulder,
          rightHip,
          leftHip,
          scaleParticleCount(TORSO_FILL_COUNT, scanProfile.fillScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.8,
            sizeMin: 1.1,
            sizeMax: 2.7,
            localSpawn: 30,
            bornOffset: 0.12,
          })
        );

        if (nose) {
          sampleTriangleParticles(
            particles,
            width,
            height,
            nose,
            leftShoulder,
            rightShoulder,
            scaleParticleCount(NECK_FILL_COUNT, scanProfile.fillScale),
            scaleParticleOptions(scanProfile, {
              spread: 2.2,
              sizeMin: 1,
              sizeMax: 2.3,
              localSpawn: 24,
              bornOffset: 0.16,
            })
          );
        }
      }

      const sampleLimbFill = (
        start: CanvasPoint | null,
        end: CanvasPoint | null,
        radiusScale: number,
        count: number
      ) => {
        if (!start || !end) return;
        sampleSegmentBandParticles(
          particles,
          width,
          height,
          start,
          end,
          scaleParticleCount(count, scanProfile.fillScale),
          bodySpan * radiusScale * scanProfile.spreadScale,
          scaleParticleOptions(scanProfile, {
            spread: 2.5,
            sizeMin: 0.95,
            sizeMax: 2.3,
            localSpawn: 28,
            bornOffset: 0.1,
          })
        );
      };

      sampleLimbFill(leftShoulder, leftElbow, 0.16, LIMB_FILL_COUNTS.upperArm);
      sampleLimbFill(leftElbow, leftWrist, 0.12, LIMB_FILL_COUNTS.forearm);
      sampleLimbFill(rightShoulder, rightElbow, 0.16, LIMB_FILL_COUNTS.upperArm);
      sampleLimbFill(rightElbow, rightWrist, 0.12, LIMB_FILL_COUNTS.forearm);
      sampleLimbFill(leftHip, leftKnee, 0.18, LIMB_FILL_COUNTS.thigh);
      sampleLimbFill(leftKnee, leftAnkle, 0.14, LIMB_FILL_COUNTS.calf);
      sampleLimbFill(rightHip, rightKnee, 0.18, LIMB_FILL_COUNTS.thigh);
      sampleLimbFill(rightKnee, rightAnkle, 0.14, LIMB_FILL_COUNTS.calf);
      sampleLimbFill(leftAnkle, leftFoot, 0.1, LIMB_FILL_COUNTS.foot);
      sampleLimbFill(leftAnkle, leftHeel, 0.08, LIMB_FILL_COUNTS.heel);
      sampleLimbFill(rightAnkle, rightFoot, 0.1, LIMB_FILL_COUNTS.foot);
      sampleLimbFill(rightAnkle, rightHeel, 0.08, LIMB_FILL_COUNTS.heel);

      if (nose && leftEar && rightEar) {
        const earSpan = getPointDistance(leftEar, rightEar);
        const centerX = (leftEar.x + rightEar.x) * 0.5;
        const centerY = (leftEar.y + rightEar.y) * 0.5 - earSpan * 0.18;
        const headRadiusX = Math.max(earSpan * 0.82, bodySpan * 0.28);
        const headRadiusY = Math.max(earSpan * 1.02, bodySpan * 0.36);

        sampleArcParticles(
          particles,
          width,
          height,
          centerX,
          centerY,
          headRadiusX,
          headRadiusY,
          scaleParticleCount(HEAD_SHELL_SAMPLES, scanProfile.densityScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.2,
            sizeMin: 1.4,
            sizeMax: 3,
            localSpawn: 34,
            bornOffset: 0.22,
          })
        );

        sampleEllipseFillParticles(
          particles,
          width,
          height,
          centerX,
          centerY + headRadiusY * 0.12,
          headRadiusX * 0.92,
          headRadiusY * 0.9,
          scaleParticleCount(HEAD_FILL_COUNT, scanProfile.fillScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.2,
            sizeMin: 1,
            sizeMax: 2.4,
            localSpawn: 28,
            bornOffset: 0.18,
          })
        );
      }

      return limitParticles(particles, MAX_POSE_PARTICLES);
    },
    [scanProfile]
  );

  const generateParticlesFromFace = useCallback(
    (landmarks: number[][], width: number, height: number) => {
      const particles: Particle[] = [];
      sampleLoopParticles(
        particles,
        landmarks,
        FACE_OVAL_LOOP,
        width,
        height,
        scaleParticleCount(FACE_OUTLINE_DENSITY, scanProfile.densityScale),
        scaleParticleOptions(scanProfile, {
          spread: 2.1,
          sizeMin: 1.7,
          sizeMax: 3.1,
          localSpawn: 40,
          bornOffset: 0.24,
        })
      );

      const ovalPoints = FACE_OVAL_LOOP
        .filter((index) => index < landmarks.length)
        .map((index) => ({ x: landmarks[index][0] * width, y: landmarks[index][1] * height }));

      if (ovalPoints.length > 0) {
        const minX = Math.min(...ovalPoints.map((point) => point.x));
        const maxX = Math.max(...ovalPoints.map((point) => point.x));
        const minY = Math.min(...ovalPoints.map((point) => point.y));
        const maxY = Math.max(...ovalPoints.map((point) => point.y));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const radiusX = (maxX - minX) * 0.42;
        const radiusY = (maxY - minY) * 0.48;
        const faceHeight = maxY - minY;
        const shellCenterY = minY + faceHeight * 0.2;
        const shellRadiusX = (maxX - minX) * 0.58;
        const shellRadiusY = faceHeight * 0.72;

        samplePolygonFillParticles(
          particles,
          width,
          height,
          ovalPoints,
          scaleParticleCount(FACE_FILL_COUNT, scanProfile.fillScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.3,
            sizeMin: 1,
            sizeMax: 2.4,
            localSpawn: 30,
            bornOffset: 0.2,
          })
        );

        sampleArcParticles(
          particles,
          width,
          height,
          centerX,
          shellCenterY,
          shellRadiusX,
          shellRadiusY,
          scaleParticleCount(FACE_SHELL_SAMPLES, scanProfile.densityScale),
          scaleParticleOptions(scanProfile, {
            spread: 2.1,
            sizeMin: 1.7,
            sizeMax: 3.3,
            localSpawn: 42,
            bornOffset: 0.28,
          })
        );

        sampleEllipseFillParticles(
          particles,
          width,
          height,
          centerX,
          centerY + radiusY * 0.05,
          radiusX * 0.95,
          radiusY * 1.02,
          scaleParticleCount(FACE_SHELL_FILL_COUNT, scanProfile.fillScale),
          scaleParticleOptions(scanProfile, {
            spread: 2,
            sizeMin: 1,
            sizeMax: 2.2,
            localSpawn: 28,
            bornOffset: 0.22,
          })
        );
      }

      return limitParticles(particles, MAX_FACE_PARTICLES);
    },
    [scanProfile]
  );

  // 更新粒子目标位置 (当 pose 更新时)
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const width = canvas.width || window.innerWidth;
    const height = canvas.height || window.innerHeight;
    const hasPose = Boolean(poseLandmarks && poseLandmarks.length >= 33);
    const hasFace = Boolean(faceLandmarks && faceLandmarks.length >= 50);

    if (!hasPose && !hasFace) return;

    const nextMode: Exclude<ParticleMode, null> = hasPose && hasFace ? 'hybrid' : hasPose ? 'pose' : 'face';
    const nextParticles = nextMode === 'hybrid'
      ? [
          ...generateParticlesFromPose(poseLandmarks!, width, height),
          ...generateParticlesFromFace(faceLandmarks!, width, height),
        ]
      : nextMode === 'pose'
        ? generateParticlesFromPose(poseLandmarks!, width, height)
        : generateParticlesFromFace(faceLandmarks!, width, height);

    // 数据源切换时重建粒子
    if (particleModeRef.current !== nextMode || particlesRef.current.length === 0) {
      particleModeRef.current = nextMode;
      particlesRef.current = nextParticles;
      startTimeRef.current = Date.now();
    } else {
      const existing = particlesRef.current;
      if (existing.length < nextParticles.length) {
        existing.push(...nextParticles.slice(existing.length));
      } else if (existing.length > nextParticles.length) {
        existing.length = nextParticles.length;
      }

      for (let i = 0; i < nextParticles.length; i++) {
        existing[i].targetX = nextParticles[i].targetX;
        existing[i].targetY = nextParticles[i].targetY;
        existing[i].born = nextParticles[i].born;
      }
    }
  }, [faceLandmarks, poseLandmarks, generateParticlesFromFace, generateParticlesFromPose]);

  // 动画循环
  useEffect(() => {
    if (currentStage !== 'SCANNING') {
      particlesRef.current = [];
      scanLineRef.current = 0;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    startTimeRef.current = Date.now();

    const animate = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const profile = scanProfileRef.current;

      // 扫描线从上到下循环 (4秒一次)
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      scanLineRef.current = (elapsed % profile.scanDuration) / profile.scanDuration;
      const scanY = scanLineRef.current;

      // 绘制扫描线
      const lineY = scanY * height;
      const gradient = ctx.createLinearGradient(0, lineY - 30, 0, lineY + 30);
      gradient.addColorStop(0, toRgba(profile.secondaryColor, 0));
      gradient.addColorStop(0.5, toRgba(profile.primaryColor, profile.beamAlpha));
      gradient.addColorStop(1, toRgba(profile.secondaryColor, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, lineY - 30, width, 60);

      // 扫描线水平光束
      ctx.strokeStyle = toRgba(profile.primaryColor, clamp(profile.beamAlpha + 0.08, 0, 1));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(width, lineY);
      ctx.stroke();

      // 更新和绘制粒子
      const particles = particlesRef.current;
      const mode = particleModeRef.current;
      const isDetailedMode = mode === 'face' || mode === 'hybrid';
      
      // 使用 lighter 混合模式实现高性能发光叠加
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        // 扫描线经过时激活粒子
        if (!p.active && (scanY >= p.born - 0.05 || mode === 'face')) {
          p.active = true;
        }

        if (!p.active) continue;

        // 粒子向目标位置移动 (弹性)
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        p.vx += dx * profile.spring;
        p.vy += dy * profile.spring;
        p.vx *= profile.damping;
        p.vy *= profile.damping;
        p.x += p.vx;
        p.y += p.vy;

        // 到达后淡入
        const dist = Math.sqrt(dx * dx + dy * dy);
        const targetAlpha = dist < 5 ? 0.96 : isDetailedMode ? profile.detailAlpha : profile.bodyAlpha;
        p.alpha += (targetAlpha - p.alpha) * 0.08;

        // 绘制粒子
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        // 使用略低的不透明度，在叠加时可以产生极佳的高频渐变亮度效果
        ctx.fillStyle = toRgba(profile.primaryColor, p.alpha * 0.52);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // 绘制骨骼连线 (半透明) - 从 ref 读取最新 pose
      const landmarks = poseLandmarksRef.current;
      const face = faceLandmarksRef.current;
      if (landmarks && landmarks.length >= 33) {
        ctx.strokeStyle = toRgba(profile.primaryColor, profile.skeletonAlpha);
        ctx.lineWidth = 1.4;
        for (const [i, j] of POSE_CONNECTIONS) {
          if (i >= landmarks.length || j >= landmarks.length) continue;
          const x1 = landmarks[i][0] * width;
          const y1 = landmarks[i][1] * height;
          const x2 = landmarks[j][0] * width;
          const y2 = landmarks[j][1] * height;

          // 只显示扫描线已经过的部分
          if (y1 / height > scanY + 0.05 || y2 / height > scanY + 0.05) continue;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      if (face && face.length >= 50) {
        ctx.strokeStyle = toRgba(profile.secondaryColor, profile.outlineAlpha);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        FACE_OVAL_LOOP.forEach((index, idx) => {
          if (index >= face.length) return;
          const x = face[index][0] * width;
          const y = face[index][1] * height;
          if (y / height > scanY + 0.08) return;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [currentStage]);

  if (currentStage !== 'SCANNING') return null;

  return (
    <canvas
      ref={canvasRef}
      className="body-scan-canvas"
    />
  );
}
