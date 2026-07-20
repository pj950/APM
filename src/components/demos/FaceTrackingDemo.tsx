/**
 * FaceTrackingDemo —— 复刻 dilmerv/FaceTrackingDemo 的 Web 版本。
 *
 * 关键点：该 Unity 项目的“面具”不是 3D 模型，而是贴在 AR 人脸网格上的 2D 面部贴图
 * （Assets/Textures 下的 cartoon / humanface / virus1 / virus2 / uv / superheros）。
 * 因此这里也用 MindAR 的人脸网格 (addFaceMesh) 做载体，把这些 Unity 原始贴图 UV 映射到
 * 实时追踪的脸上，并每 5 秒自动轮换一张，对齐 Unity 里 ToggleFace 的切换演示。
 *
 * - MindAR (WebAR) 独占摄像头 + Three.js 渲染（CV 管线已在 useCVCapture 中排除 QUESTIONING / FACE_DEMO）。
 * - 贴图全部预加载，切换时只替换流动着色器的 uMap uniform，零延迟。
 * - 使用 Three.js 的 PBR MeshStandardMaterial 对齐 Unity Universal PBR；只通过 onBeforeCompile
 *   注入原 ShaderGraph 的 UV Rotate(Time) + texture ×2，避免手写五官阴影造成贴纸感。
 * - 原项目材质是 Opaque + Alpha=1，眼睛/嘴巴不是透明挖洞；Web 版同样保留整张动态 face mesh 覆盖。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-face-three.prod.js';
import { useAppStore } from '../../store/useAppStore';
import { prefetchTTS, speakWithPreset, stopSpeaking } from '../../services/tts';
import type { PersonalityDimensions, VoicePresetKey } from '../../types';

/** 贴图自动轮换间隔（毫秒），对齐 Unity ToggleFace 演示 */
const FACE_SWITCH_INTERVAL_MS = 5000;

/** 来自 dilmerv/FaceTrackingDemo 的 Unity 原始面部贴图（已下载到 public/unity-face/textures） */
const UNITY_FACE_TEXTURES: Array<{ file: string; label: string }> = [
  { file: 'superheros.jpg', label: 'Superheros' },
  { file: 'cartoon.png', label: 'Cartoon' },
  { file: 'uv.png', label: 'UV Debug' },
];

let faceDemoAssetsPreloadPromise: Promise<void> | null = null;

export function preloadFaceDemoAssets() {
  if (faceDemoAssetsPreloadPromise) return faceDemoAssetsPreloadPromise;

  faceDemoAssetsPreloadPromise = Promise.all(
    UNITY_FACE_TEXTURES.map(({ file }) =>
      fetch(`${import.meta.env.BASE_URL}unity-face/textures/${file}`, { cache: 'force-cache' })
        .then(() => undefined)
        .catch((err) => {
          console.warn(`[FaceTrackingDemo] 贴图预加载失败: ${file}`, err);
        }),
    ),
  ).then(() => undefined);

  return faceDemoAssetsPreloadPromise;
}

type FaceQuestion = {
  id: string;
  text: string;
  dimensionKey: keyof PersonalityDimensions;
  options: [
    { label: string; value: 0 },
    { label: string; value: 1 },
  ];
};

const FACE_QUESTIONS: FaceQuestion[] = [
  {
    id: 'q1',
    text: '如果你的微信钱包会说话，它最可能对你发出什么嘲笑？',
    dimensionKey: 'capital',
    options: [
      { label: '💸 “吃土吃出米其林质感”', value: 0 },
      { label: '🤑 “呼吸都在狂吸GDP”', value: 1 },
    ],
  },
  {
    id: 'q2',
    text: '深夜emo时，你的灵魂通常会漂向哪个终极归宿？',
    dimensionKey: 'spirit',
    options: [
      { label: '🧘 “电子木鱼敲到冒烟”', value: 0 },
      { label: '🍾 “接着奏乐接着舞”', value: 1 },
    ],
  },
  {
    id: 'q3',
    text: '你的大脑在面对高数或复杂说明书时会如何运转？',
    dimensionKey: 'intellect',
    options: [
      { label: '🤪 “脑干缺失，眼神清澈”', value: 0 },
      { label: '🧠 “量子纠缠，学术风暴”', value: 1 },
    ],
  },
  {
    id: 'q4',
    text: '如果必须去参加一个陌生人的社交派对，你会？',
    dimensionKey: 'social',
    options: [
      { label: '🦪 “自闭贝壳，角落抠地”', value: 0 },
      { label: '🦋 “社牛附体，全场聊遍”', value: 1 },
    ],
  },
  {
    id: 'q5',
    text: '看到一张歪了2毫米的画，或者手机上未读的小红点？',
    dimensionKey: 'order',
    options: [
      { label: '🌪 “随缘摆烂，混沌自在”', value: 0 },
      { label: '📐 “像素对齐，逼死强迫”', value: 1 },
    ],
  },
  {
    id: 'q6',
    text: '周末早晨醒来，你全身的电量和生命体征呈现什么状态？',
    dimensionKey: 'energy',
    options: [
      { label: '🔋 “省电咸鱼，安祥躺平”', value: 0 },
      { label: '⚡ “发电机转世，不知疲倦”', value: 1 },
    ],
  },
];

const FACE_SELECT_HOLD_MS = 1500;
const FACE_SELECT_YAW_THRESHOLD = 0.28;
const FACE_SELECT_CONFIRM_PAUSE_MS = 1100;
const FACE_DEMO_VOICE_PRESET: VoicePresetKey = 'crystal';
const LEFT_EYE_CORNERS = [33, 133] as const;
const RIGHT_EYE_CORNERS = [362, 263] as const;
const LEFT_EYE_UPPER = [159, 158] as const;
const RIGHT_EYE_UPPER = [386, 385] as const;
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const DEBUG_EYE_LASER_ORIGIN = false;
const MOUTH_STABILIZE_LANDMARKS = [
  0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95, 146, 178, 181, 185, 191,
  267, 269, 270, 291, 308, 310, 311, 312, 314, 317, 318, 321, 324, 375, 402, 405, 409, 415,
] as const;
const MOUTH_OPEN_REFERENCE_LANDMARKS = { upper: 13, lower: 14 } as const;
const MOUTH_NEUTRAL_UPDATE_DISTANCE = 0.075;
const MOUTH_STABILIZE_START_DISTANCE = 0.09;
const MOUTH_STABILIZE_FULL_DISTANCE = 0.24;
const MOUTH_STABILIZE_MAX_BLEND = 0.68;
const FAST_TURN_MIN_YAW_SPEED = 0.9;
const FAST_TURN_MAX_PREDICTION_SECONDS = 0.065;
const FAST_TURN_PREDICTION_BIAS_SECONDS = 0.024;
const FAST_TURN_MAX_YAW_LEAD = 0.16;

type MindARFaceGeometry = THREE.BufferGeometry & {
  updatePositions?: (landmarks: number[][]) => void;
};

function toSpeechLabel(label: string) {
  return label.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim();
}

function patchFaceMeshDeformation(geometry: MindARFaceGeometry) {
  if (!geometry.updatePositions) return;

  const originalUpdatePositions = geometry.updatePositions.bind(geometry);
  const uv = geometry.getAttribute('uv');
  const neutralMouthPositions = new Float32Array(MOUTH_STABILIZE_LANDMARKS.length * 3);
  let hasNeutralMouth = false;

  const captureNeutralMouth = (position: THREE.BufferAttribute) => {
    for (let i = 0; i < MOUTH_STABILIZE_LANDMARKS.length; i += 1) {
      const idx = MOUTH_STABILIZE_LANDMARKS[i];
      if (idx >= position.count) continue;
      const offset = i * 3;
      neutralMouthPositions[offset] = position.getX(idx);
      neutralMouthPositions[offset + 1] = position.getY(idx);
      neutralMouthPositions[offset + 2] = position.getZ(idx);
    }
    hasNeutralMouth = true;
  };

  geometry.updatePositions = (landmarks: number[][]) => {
    originalUpdatePositions(landmarks);

    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!uv || !position) return;

    const upperMouth = landmarks[MOUTH_OPEN_REFERENCE_LANDMARKS.upper];
    const lowerMouth = landmarks[MOUTH_OPEN_REFERENCE_LANDMARKS.lower];
    const mouthOpenDistance = upperMouth && lowerMouth
      ? Math.hypot(
          lowerMouth[0] - upperMouth[0],
          lowerMouth[1] - upperMouth[1],
          lowerMouth[2] - upperMouth[2],
        )
      : 0;

    if (!hasNeutralMouth || mouthOpenDistance < MOUTH_NEUTRAL_UPDATE_DISTANCE) {
      captureNeutralMouth(position);
    }

    const mouthStabilize = hasNeutralMouth
      ? THREE.MathUtils.smoothstep(mouthOpenDistance, MOUTH_STABILIZE_START_DISTANCE, MOUTH_STABILIZE_FULL_DISTANCE) *
        MOUTH_STABILIZE_MAX_BLEND
      : 0;

    if (mouthStabilize > 0) {
      for (let i = 0; i < MOUTH_STABILIZE_LANDMARKS.length; i += 1) {
        const idx = MOUTH_STABILIZE_LANDMARKS[i];
        if (idx >= position.count) continue;
        const offset = i * 3;
        position.setXYZ(
          idx,
          THREE.MathUtils.lerp(position.getX(idx), neutralMouthPositions[offset], mouthStabilize),
          THREE.MathUtils.lerp(position.getY(idx), neutralMouthPositions[offset + 1], mouthStabilize),
          THREE.MathUtils.lerp(position.getZ(idx), neutralMouthPositions[offset + 2], mouthStabilize),
        );
      }
    }

    for (let i = 0; i < position.count; i += 1) {
      const v = uv.getY(i);
      const forehead = THREE.MathUtils.smoothstep(v, 0.64, 0.9);
      if (forehead <= 0) continue;

      position.setY(i, position.getY(i) + forehead * 1.25);
      position.setX(i, position.getX(i) * (1 + forehead * 0.035));
      position.setZ(i, position.getZ(i) + forehead * 0.08);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}

function createCartoonAnimatedMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map,
    color: new THREE.Color(1.0, 1.0, 1.0),
    emissive: new THREE.Color(0.0, 0.0, 0.0),
    emissiveIntensity: 0.0,
    metalness: 1.0,
    roughness: 0.305,
    envMapIntensity: 1.65,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uRotSpeed = { value: 0.85 };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uTime;
      uniform float uRotSpeed;

      vec2 rotateFaceUv(vec2 uv, float rot) {
        float c = cos(rot);
        float s = sin(rot);
        uv -= 0.5;
        uv = mat2(c, -s, s, c) * uv;
        uv += 0.5;
        return uv;
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 rotatedMapUv = rotateFaceUv(vMapUv, uTime * uRotSpeed);
        vec4 sampledDiffuseColor = texture2D(map, rotatedMapUv);
        sampledDiffuseColor.rgb *= 2.0;
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
    material.userData.shader = shader;
  };

  return material;
}

function createPlaceholderFaceTexture() {
  const data = new Uint8Array([255, 255, 255, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function releaseExistingCameraStreams(skipWithin?: Element | null) {
  const videos = Array.from(document.querySelectorAll('video'));
  videos.forEach((video) => {
    if (skipWithin?.contains(video)) return;
    const src = video.srcObject;
    if (!(src instanceof MediaStream)) return;
    src.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  });
}

function clearMindArInjectedMedia(container: HTMLElement) {
  container.querySelectorAll('video, canvas').forEach((node) => node.remove());
}

// 答题页(MindAR)摄像头持久化：MindAR 内部会自己 getUserMedia 并在停止时关闭摄像头，
// 导致“授权 -> 退出 -> 再进入又要选摄像头/再授权”的反复弹窗。这里在进入答题期间拦截
// getUserMedia：首次真实申请一次并把这条流留作 keeper（持有设备），交给 MindAR 的是它的克隆；
// 之后再进入直接返回 keeper 的克隆，不再触发真实申请/权限弹窗。退出不停 keeper，空闲计时后才释放。
const FACE_CAMERA_IDLE_MS = 4 * 60 * 1000;
let faceKeeperStream: MediaStream | null = null;
let faceKeeperIdleTimer: number | null = null;
let originalGetUserMedia: ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | null = null;

function faceKeeperHasLiveVideo() {
  return Boolean(faceKeeperStream?.getVideoTracks().some((track) => track.readyState === 'live'));
}

function cloneFaceKeeperStream(): MediaStream {
  return new MediaStream((faceKeeperStream as MediaStream).getVideoTracks().map((track) => track.clone()));
}

function patchGetUserMediaForFaceReuse() {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia || originalGetUserMedia) return;
  originalGetUserMedia = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const wantsVideo = Boolean(constraints && constraints.video);
    if (wantsVideo && faceKeeperHasLiveVideo()) {
      // 复用已授权 keeper：返回克隆，MindAR 停止克隆时不会杀掉 keeper。
      return cloneFaceKeeperStream();
    }
    const stream = await (originalGetUserMedia as (c?: MediaStreamConstraints) => Promise<MediaStream>)(constraints);
    if (wantsVideo) {
      faceKeeperStream = stream; // 真正的一条留作 keeper（持有设备），MindAR 拿克隆
      return cloneFaceKeeperStream();
    }
    return stream;
  };
}

function unpatchGetUserMediaForFaceReuse() {
  if (originalGetUserMedia && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    originalGetUserMedia = null;
  }
}

function stopFaceKeeperStream() {
  if (faceKeeperStream) {
    faceKeeperStream.getTracks().forEach((track) => track.stop());
    faceKeeperStream = null;
  }
}

function cancelFaceKeeperIdleStop() {
  if (faceKeeperIdleTimer !== null) {
    window.clearTimeout(faceKeeperIdleTimer);
    faceKeeperIdleTimer = null;
  }
}

function scheduleFaceKeeperIdleStop() {
  cancelFaceKeeperIdleStop();
  faceKeeperIdleTimer = window.setTimeout(() => {
    stopFaceKeeperStream();
  }, FACE_CAMERA_IDLE_MS);
}

async function sleep(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function startMindArWithRetry(mindarThree: MindARThree, maxAttempts = 3) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sleep(attempt === 1 ? 180 : 420);
      await mindarThree.start();
      return;
    } catch (err) {
      lastError = err;
      try {
        mindarThree.stop();
      } catch {
        /* 忽略停止异常 */
      }
      if (attempt < maxAttempts) {
        await sleep(320 * attempt);
      }
    }
  }

  throw lastError ?? new Error('摄像头启动失败');
}

export function FaceTrackingDemo() {
  const setStage = useAppStore((s) => s.setStage);
  const triggerGeneration = useAppStore((s) => s.triggerGeneration);
  const setVoicePreset = useAppStore((s) => s.setVoicePreset);
  const setMirrorSpeaking = useAppStore((s) => s.setMirrorSpeaking);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [cameraRetrySeed, setCameraRetrySeed] = useState(0);
  const [activeLabel, setActiveLabel] = useState<string>('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<(0 | 1)[]>(Array(FACE_QUESTIONS.length).fill(-1));
  const [lookOption, setLookOption] = useState<0 | 1 | null>(null);
  const [confirmedOption, setConfirmedOption] = useState<0 | 1 | null>(null);
  const [confirmFx, setConfirmFx] = useState<{ side: 0 | 1; key: number } | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [faceYaw, setFaceYaw] = useState(0);
  const [laserOrigins, setLaserOrigins] = useState<{ left: { x: number; y: number }; right: { x: number; y: number } }>({
    left: { x: 452, y: 176 },
    right: { x: 508, y: 176 },
  });

  const currentIdxRef = useRef(0);
  const answersRef = useRef<(0 | 1)[]>(Array(FACE_QUESTIONS.length).fill(-1));
  const commitAnswerRef = useRef<(value: 0 | 1) => void>(() => undefined);
  const selectionStartAtRef = useRef<number | null>(null);
  const selectionOptionRef = useRef<0 | 1 | null>(null);
  const selectionLockedRef = useRef(false);
  const faceYawSampleFrameRef = useRef(0);
  const confirmFxKeyRef = useRef(0);
  const laserOriginsRef = useRef<{ left: { x: number; y: number }; right: { x: number; y: number } }>({
    left: { x: 452, y: 176 },
    right: { x: 508, y: 176 },
  });
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([null, null]);

  const question = FACE_QUESTIONS[currentIdx];
  const [presets] = useState<VoicePresetKey[]>(() => FACE_QUESTIONS.map(() => FACE_DEMO_VOICE_PRESET));

  useEffect(() => {
    currentIdxRef.current = currentIdx;
    useAppStore.getState().setActiveDimensionKey(FACE_QUESTIONS[currentIdx]?.dimensionKey || null);
    return () => {
      useAppStore.getState().setActiveDimensionKey(null);
    };
  }, [currentIdx]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    FACE_QUESTIONS.forEach((item, index) => {
      const speechText = [
        `第 ${index + 1} 题。${item.text}。`,
        `看向左侧选择左边，${toSpeechLabel(item.options[0].label)}。`,
        `看向右侧选择右边，${toSpeechLabel(item.options[1].label)}。`,
        '持续保持大约一点五秒即可确认。',
      ].join(' ');
      void prefetchTTS(speechText, presets[index]);
    });
  }, [presets]);

  const readQuestion = useCallback(() => {
    const activeQuestion = FACE_QUESTIONS[currentIdxRef.current];
    if (!activeQuestion) return;

    const presetToUse = presets[currentIdxRef.current];
    setVoicePreset(presetToUse);
    const speechText = [
      `第 ${currentIdxRef.current + 1} 题。${activeQuestion.text}。`,
      `看向左侧选择左边，${toSpeechLabel(activeQuestion.options[0].label)}。`,
      `看向右侧选择右边，${toSpeechLabel(activeQuestion.options[1].label)}。`,
      '持续保持大约一点五秒即可确认。',
    ].join(' ');

    speakWithPreset(
      speechText,
      presetToUse,
      () => setMirrorSpeaking(true),
      () => setMirrorSpeaking(false),
    );
  }, [presets, setMirrorSpeaking, setVoicePreset]);

  useEffect(() => {
    if (status !== 'running') return;

    const timer = window.setTimeout(() => {
      readQuestion();
    }, 80);

    return () => {
      window.clearTimeout(timer);
      stopSpeaking();
      setMirrorSpeaking(false);
    };
  }, [currentIdx, readQuestion, setMirrorSpeaking, status]);

  const recordAndGenerate = useCallback((finalAnswers: (0 | 1)[]) => {
    const dims: PersonalityDimensions = {
      capital: finalAnswers[0] as 0 | 1,
      spirit: finalAnswers[1] as 0 | 1,
      intellect: finalAnswers[2] as 0 | 1,
      social: finalAnswers[3] as 0 | 1,
      order: finalAnswers[4] as 0 | 1,
      energy: finalAnswers[5] as 0 | 1,
    };
    useAppStore.setState({ personalityDimensions: dims });
    window.setTimeout(() => triggerGeneration(), 300);
  }, [triggerGeneration]);

  const handleAnswer = useCallback((value: 0 | 1) => {
    if (selectionLockedRef.current) return;
    selectionLockedRef.current = true;
    setConfirmedOption(value);
    confirmFxKeyRef.current += 1;
    setConfirmFx({ side: value, key: confirmFxKeyRef.current });
    stopSpeaking();
    setMirrorSpeaking(false);

    const activeIdx = currentIdxRef.current;
    const nextAnswers = [...answersRef.current];
    nextAnswers[activeIdx] = value;
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setLookOption(null);
    setHoldProgress(0);
    selectionStartAtRef.current = null;
    selectionOptionRef.current = null;

    if (activeIdx < FACE_QUESTIONS.length - 1) {
      window.setTimeout(() => {
        currentIdxRef.current = activeIdx + 1;
        setCurrentIdx(activeIdx + 1);
        setConfirmedOption(null);
        setConfirmFx(null);
        selectionLockedRef.current = false;
      }, FACE_SELECT_CONFIRM_PAUSE_MS);
    } else {
      recordAndGenerate(nextAnswers);
    }
  }, [recordAndGenerate, setMirrorSpeaking]);

  useEffect(() => {
    commitAnswerRef.current = handleAnswer;
  }, [handleAnswer]);

  const handlePrevious = useCallback(() => {
    if (currentIdxRef.current <= 0) return;
    stopSpeaking();
    setMirrorSpeaking(false);
    const previous = currentIdxRef.current - 1;
    currentIdxRef.current = previous;
    selectionLockedRef.current = false;
    setConfirmedOption(null);
    setConfirmFx(null);
    setLookOption(null);
    setHoldProgress(0);
    setCurrentIdx(previous);
  }, [setMirrorSpeaking]);

  const handleCancel = useCallback(() => {
    stopSpeaking();
    setMirrorSpeaking(false);
    setConfirmFx(null);
    useAppStore.getState().setActiveDimensionKey(null);
    setStage('STANDBY');
  }, [setMirrorSpeaking, setStage]);

  const interactionStatus = useMemo(() => {
    if (confirmedOption === 0) return `已选择左侧：${question.options[0].label}`;
    if (confirmedOption === 1) return `已选择右侧：${question.options[1].label}`;
    if (lookOption === 0) return '看向左侧确认中';
    if (lookOption === 1) return '看向右侧确认中';
    return '正视屏幕后，看向左侧或右侧作答';
  }, [confirmedOption, lookOption, question.options]);

  const buildLaserStyle = useCallback((side: 0 | 1, charge: number, eye: 'left' | 'right') => {
    const root = rootRef.current;
    const targetButton = optionButtonRefs.current[side];
    const origin = laserOrigins[eye];
    if (!root || !targetButton) {
      return {
        '--face-laser-origin-x': `${origin.x}px`,
        '--face-laser-origin-y': `${origin.y}px`,
        '--face-laser-length': '380px',
        '--face-laser-angle': side === 0 ? '182deg' : '-2deg',
        '--face-laser-charge': `${charge}`,
      } as CSSProperties;
    }

    const rootRect = root.getBoundingClientRect();
    const targetRect = targetButton.getBoundingClientRect();
    const targetX = targetRect.left - rootRect.left + targetRect.width * 0.5;
    const targetY = targetRect.top - rootRect.top + targetRect.height * 0.5;
    const rawDx = targetX - origin.x;
    const rawDy = targetY - origin.y;
    const rawLen = Math.max(1, Math.hypot(rawDx, rawDy));
    const nx = -rawDy / rawLen;
    const ny = rawDx / rawLen;
    const splitOffset = eye === 'left' ? -24 : 24;
    const splitTargetX = targetX + nx * splitOffset;
    const splitTargetY = targetY + ny * splitOffset;

    const dx = splitTargetX - origin.x;
    const dy = splitTargetY - origin.y;
    const length = Math.max(120, Math.hypot(dx, dy));
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    return {
      '--face-laser-origin-x': `${origin.x}px`,
      '--face-laser-origin-y': `${origin.y}px`,
      '--face-laser-length': `${length}px`,
      '--face-laser-angle': `${angle}deg`,
      '--face-laser-charge': `${charge}`,
      '--face-laser-split': `${splitOffset}px`,
    } as CSSProperties;
  }, [laserOrigins]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let mindarThree: MindARThree | null = null;
    let switchTimer: number | null = null;
    const textures: THREE.Texture[] = [];
    const placeholderTexture = createPlaceholderFaceTexture();

    const cleanup = () => {
      if (switchTimer !== null) {
        window.clearInterval(switchTimer);
        switchTimer = null;
      }
      try {
        mindarThree?.stop();
      } catch {
        /* 忽略停止异常 */
      }
      try {
        mindarThree?.renderer?.setAnimationLoop(null);
        mindarThree?.renderer?.dispose();
      } catch {
        /* 忽略渲染器释放异常 */
      }
      clearMindArInjectedMedia(container);
      placeholderTexture.dispose();
      for (const tex of textures) tex.dispose();
      textures.length = 0;
      mindarThree = null;
      // 恢复原始 getUserMedia，避免拦截影响其他阶段；keeper 不立即停，改为空闲计时释放，
      // 短时间内再次进入答题会直接复用同一条已授权流，不再弹权限/摄像头选择。
      unpatchGetUserMediaForFaceReuse();
      scheduleFaceKeeperIdleStop();
    };

    const run = async () => {
      try {
        // 进入答题：先取消 keeper 空闲释放并安装 getUserMedia 拦截，让 MindAR 复用已授权流。
        cancelFaceKeeperIdleStop();
        patchGetUserMediaForFaceReuse();
        // Release any existing getUserMedia streams first to avoid device-busy races
        // when switching from SCANNING/QUESTIONING_TEST into MindAR QUESTIONING.
        releaseExistingCameraStreams(container);
        clearMindArInjectedMedia(container);
        await new Promise((resolve) => window.setTimeout(resolve, 120));

        mindarThree = new MindARThree({
          container,
          uiLoading: 'no',
          uiScanning: 'no',
          uiError: 'no',
          // 提高 OneEuro 动态响应，减少快速侧转时的贴图滞后。
          filterMinCF: 0.012,
          filterBeta: 850,
        });

        const { scene, renderer } = mindarThree;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x1c2230, 1.15));
        const keyLight = new THREE.DirectionalLight(0xfff0d8, 2.15);
        keyLight.position.set(-1.8, 2.4, 3.2);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x88b8ff, 0.55);
        fillLight.position.set(2.2, 0.6, 1.6);
        scene.add(fillLight);

        // 首屏先启动 MindAR，真实贴图并行加载，避免“贴图网络/解码 -> 摄像头”串行等待。
        setLoadProgress({ done: 0, total: 2 });
        const loader = new THREE.TextureLoader();
        const loadOne = (file: string) =>
          new Promise<THREE.Texture | null>((resolve) => {
            loader.load(
              `${import.meta.env.BASE_URL}unity-face/textures/${file}`,
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false; // MindAR/MediaPipe 人脸网格 UV 与 glTF 一致，需关闭翻转
                resolve(tex);
              },
              undefined,
              (err) => {
                console.warn(`[FaceTrackingDemo] 贴图加载失败: ${file}`, err);
                resolve(null);
              },
            );
          });

        const validIndices: number[] = [];

        // 人脸网格作为贴图载体（UV 映射到追踪到的脸上）
        const faceMesh = mindarThree.addFaceMesh();
        const faceGeometry = faceMesh.geometry as MindARFaceGeometry;
        patchFaceMeshDeformation(faceGeometry);
        const faceMaterial = createCartoonAnimatedMaterial(placeholderTexture);
        faceMesh.material = faceMaterial;
        faceMesh.frustumCulled = false;
        // 注意：MindAR 的 addFaceMesh 只把 mesh 推入内部数组用于更新矩阵/可见性，
        // 并不会自动加入场景，必须手动 add，否则贴图永远不会被渲染。
        scene.add(faceMesh);

        if (disposed) return;
  setLoadProgress({ done: 1, total: 2 });

        const { camera } = mindarThree;
        const clock = new THREE.Clock();
        const faceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        const faceQuaternion = new THREE.Quaternion();
        const faceWorldPos = new THREE.Vector3();
        const faceWorldScale = new THREE.Vector3();
        const projected = new THREE.Vector3();
        const leftEyeWorld = new THREE.Vector3();
        const rightEyeWorld = new THREE.Vector3();
        const forwardDir = new THREE.Vector3();
        const rightDir = new THREE.Vector3();
        const upDir = new THREE.Vector3();
        const eyeLocal = new THREE.Vector3();
        const rawFaceMatrix = new THREE.Matrix4();
        const predictedFaceMatrix = new THREE.Matrix4();
        const rawFacePosition = new THREE.Vector3();
        const rawFaceQuaternion = new THREE.Quaternion();
        const rawFaceScale = new THREE.Vector3();
        const rawFaceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        const predictedFaceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        const predictedFaceQuaternion = new THREE.Quaternion();
        let hasRawFacePose = false;
        let lastRawFaceAt = 0;
        let lastRawFaceYaw = 0;
        let rawFaceYawVelocity = 0;

        const originalFaceMatrixSet = faceMesh.matrix.set.bind(faceMesh.matrix);
        faceMesh.matrix.set = ((...elements: Parameters<THREE.Matrix4['set']>) => {
          const result = originalFaceMatrixSet(...elements);
          const now = performance.now();
          rawFaceMatrix.copy(faceMesh.matrix);
          rawFaceMatrix.decompose(rawFacePosition, rawFaceQuaternion, rawFaceScale);
          rawFaceEuler.setFromQuaternion(rawFaceQuaternion, 'YXZ');
          if (hasRawFacePose) {
            const dt = Math.max(0.001, (now - lastRawFaceAt) / 1000);
            rawFaceYawVelocity = THREE.MathUtils.clamp((rawFaceEuler.y - lastRawFaceYaw) / dt, -8, 8);
          }
          hasRawFacePose = true;
          lastRawFaceAt = now;
          lastRawFaceYaw = rawFaceEuler.y;
          return result;
        }) as THREE.Matrix4['set'];

        const applyFastTurnPrediction = () => {
          if (!hasRawFacePose || Math.abs(rawFaceYawVelocity) < FAST_TURN_MIN_YAW_SPEED) return;

          const elapsedSinceRaw = Math.max(0, (performance.now() - lastRawFaceAt) / 1000);
          const predictionSeconds = Math.min(
            FAST_TURN_MAX_PREDICTION_SECONDS,
            elapsedSinceRaw + FAST_TURN_PREDICTION_BIAS_SECONDS,
          );
          const yawLead = THREE.MathUtils.clamp(
            rawFaceYawVelocity * predictionSeconds,
            -FAST_TURN_MAX_YAW_LEAD,
            FAST_TURN_MAX_YAW_LEAD,
          );

          predictedFaceEuler.set(rawFaceEuler.x, rawFaceEuler.y + yawLead, rawFaceEuler.z, 'YXZ');
          predictedFaceQuaternion.setFromEuler(predictedFaceEuler);
          predictedFaceMatrix.compose(rawFacePosition, predictedFaceQuaternion, rawFaceScale);
          faceMesh.matrix.copy(predictedFaceMatrix);
          faceMesh.matrixWorldNeedsUpdate = true;
        };

        const projectEye = (
          origin: THREE.Vector3,
          rootRect: DOMRect,
          canvasRect: DOMRect,
          out: { x: number; y: number },
        ) => {
          projected.copy(origin).project(camera);
          const canvasX = canvasRect.left - rootRect.left + ((projected.x + 1) * 0.5) * canvasRect.width;
          const canvasY = canvasRect.top - rootRect.top + ((1 - projected.y) * 0.5) * canvasRect.height;
          out.x = THREE.MathUtils.clamp(canvasX, 14, rootRect.width - 14);
          out.y = THREE.MathUtils.clamp(canvasY, 18, rootRect.height - 18);
        };

        const sampleEyeAnchorWorld = (
          corners: readonly number[],
          uppers: readonly number[],
          irisIndex: number,
          out: THREE.Vector3,
        ) => {
          const position = faceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
          if (!position || position.count <= 0) return false;

          if (irisIndex < position.count) {
            out.set(position.getX(irisIndex), position.getY(irisIndex), position.getZ(irisIndex));
            faceMesh.localToWorld(out);
            return true;
          }

          let cornerX = 0;
          let cornerY = 0;
          let cornerZ = 0;
          let cornerValid = 0;
          for (const idx of corners) {
            if (idx >= position.count) continue;
            cornerX += position.getX(idx);
            cornerY += position.getY(idx);
            cornerZ += position.getZ(idx);
            cornerValid += 1;
          }

          let upperX = 0;
          let upperY = 0;
          let upperZ = 0;
          let upperValid = 0;
          for (const idx of uppers) {
            if (idx >= position.count) continue;
            upperX += position.getX(idx);
            upperY += position.getY(idx);
            upperZ += position.getZ(idx);
            upperValid += 1;
          }

          if (cornerValid === 0 || upperValid === 0) return false;

          const cornerMidX = cornerX / cornerValid;
          const cornerMidY = cornerY / cornerValid;
          const cornerMidZ = cornerZ / cornerValid;
          const upperMidX = upperX / upperValid;
          const upperMidY = upperY / upperValid;
          const upperMidZ = upperZ / upperValid;

          // Anchor at geometric midpoint between canthus center and upper-eyelid center.
          eyeLocal.set(
            (cornerMidX + upperMidX) * 0.5,
            (cornerMidY + upperMidY) * 0.5,
            (cornerMidZ + upperMidZ) * 0.5,
          );
          out.copy(eyeLocal);
          faceMesh.localToWorld(out);
          return true;
        };

        renderer.setAnimationLoop(() => {
          applyFastTurnPrediction();

          // Ensure projection uses latest world transforms for this frame.
          faceMesh.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);

          const shader = faceMaterial.userData.shader as { uniforms?: Record<string, { value: unknown }> } | undefined;
          const elapsed = clock.getElapsedTime();
          if (shader?.uniforms?.uTime) shader.uniforms.uTime.value = elapsed;

          faceMesh.getWorldQuaternion(faceQuaternion);
          faceEuler.setFromQuaternion(faceQuaternion, 'YXZ');
          const yaw = -faceEuler.y;
          const now = performance.now();
          const nextOption = yaw > FACE_SELECT_YAW_THRESHOLD ? 0 : yaw < -FACE_SELECT_YAW_THRESHOLD ? 1 : null;

          if (faceYawSampleFrameRef.current % 3 === 0) {
            setFaceYaw(yaw);

            // 分别投影左右眼近似位置，渲染为双束激光。
            faceMesh.getWorldPosition(faceWorldPos);
            faceMesh.getWorldScale(faceWorldScale);
            const rootRect = rootRef.current?.getBoundingClientRect();
            const canvasRect = renderer.domElement.getBoundingClientRect();
            if (rootRect && canvasRect.width > 0 && canvasRect.height > 0) {
              forwardDir.set(0, 0, 1).applyQuaternion(faceQuaternion).normalize();
              upDir.set(0, 1, 0).applyQuaternion(faceQuaternion).normalize();
              const eyeForwardOffset = Math.max(faceWorldScale.z * 0.06, 0.03);
              const eyeSideOffset = Math.max(faceWorldScale.x * 0.18, 0.045);
              const eyeUpOffset = Math.max(faceWorldScale.y * 0.045, 0.02);

              const nextLeft = { x: 0, y: 0 };
              const nextRight = { x: 0, y: 0 };

              const hasLeftEye = sampleEyeAnchorWorld(LEFT_EYE_CORNERS, LEFT_EYE_UPPER, LEFT_IRIS_CENTER, leftEyeWorld);
              const hasRightEye = sampleEyeAnchorWorld(RIGHT_EYE_CORNERS, RIGHT_EYE_UPPER, RIGHT_IRIS_CENTER, rightEyeWorld);
              if (hasLeftEye && hasRightEye) {
                leftEyeWorld.addScaledVector(forwardDir, eyeForwardOffset);
                rightEyeWorld.addScaledVector(forwardDir, eyeForwardOffset);
                projectEye(leftEyeWorld, rootRect, canvasRect, nextLeft);
                projectEye(rightEyeWorld, rootRect, canvasRect, nextRight);
              } else {
                // Fallback to pose-derived eye anchors so laser origin still tracks the face
                // when mesh eye landmarks are temporarily unavailable.
                rightDir.set(1, 0, 0).applyQuaternion(faceQuaternion).normalize();

                leftEyeWorld
                  .copy(faceWorldPos)
                  .addScaledVector(rightDir, -eyeSideOffset)
                  .addScaledVector(upDir, eyeUpOffset)
                  .addScaledVector(forwardDir, eyeForwardOffset);
                rightEyeWorld
                  .copy(faceWorldPos)
                  .addScaledVector(rightDir, eyeSideOffset)
                  .addScaledVector(upDir, eyeUpOffset)
                  .addScaledVector(forwardDir, eyeForwardOffset);

                projectEye(leftEyeWorld, rootRect, canvasRect, nextLeft);
                projectEye(rightEyeWorld, rootRect, canvasRect, nextRight);
              }

              if (
                Number.isFinite(nextLeft.x) &&
                Number.isFinite(nextLeft.y) &&
                Number.isFinite(nextRight.x) &&
                Number.isFinite(nextRight.y)
              ) {
                const prev = laserOriginsRef.current;
                const moved =
                  Math.abs(prev.left.x - nextLeft.x) > 1.2 ||
                  Math.abs(prev.left.y - nextLeft.y) > 1.2 ||
                  Math.abs(prev.right.x - nextRight.x) > 1.2 ||
                  Math.abs(prev.right.y - nextRight.y) > 1.2;

                if (moved) {
                  laserOriginsRef.current = { left: nextLeft, right: nextRight };
                  setLaserOrigins({ left: nextLeft, right: nextRight });
                }
              }
            }
          }
          faceYawSampleFrameRef.current += 1;

          if (selectionLockedRef.current) {
            setLookOption(null);
            setHoldProgress(0);
          } else if (nextOption === null) {
            selectionStartAtRef.current = null;
            selectionOptionRef.current = null;
            setLookOption(null);
            setHoldProgress(0);
          } else {
            if (selectionOptionRef.current !== nextOption) {
              selectionOptionRef.current = nextOption;
              selectionStartAtRef.current = now;
            }
            const startedAt = selectionStartAtRef.current ?? now;
            const progress = Math.min(1, (now - startedAt) / FACE_SELECT_HOLD_MS);
            setLookOption(nextOption);
            setHoldProgress(progress);
            if (progress >= 1) {
              commitAnswerRef.current(nextOption);
            }
          }

          renderer.render(scene, camera);
        });

        // 自动轮换：替换流动材质的贴图 uniform（支持后台新增贴图）
        let cursor = 0;
        const showFace = (idx: number) => {
          if (!textures[idx]) return;
          faceMaterial.map = textures[idx];
          faceMaterial.needsUpdate = true;
          const originalIndex = validIndices[idx];
          setActiveLabel(UNITY_FACE_TEXTURES[originalIndex].label);
        };

        void startMindArWithRetry(mindarThree, 3)
          .then(() => {
            if (disposed) return;
            setLoadProgress((p) => ({ done: Math.min(p.done + 1, p.total), total: p.total }));
            setStatus('running');
          })
          .catch((err) => {
            if (disposed) return;
            console.error('[FaceTrackingDemo] 摄像头启动失败', err);
            setErrorMessage(err instanceof Error ? err.message : '摄像头启动失败，请检查权限或设备占用后重试');
            setStatus('error');
          });

        void (async () => {
          let showedFirstTexture = false;
          for (let i = 0; i < UNITY_FACE_TEXTURES.length; i += 1) {
            const tex = await loadOne(UNITY_FACE_TEXTURES[i].file);
            if (!tex) continue;
            if (disposed) {
              tex.dispose();
              continue;
            }

            textures.push(tex);
            validIndices.push(i);
            if (!showedFirstTexture) {
              showedFirstTexture = true;
              cursor = 0;
              showFace(cursor);
              setLoadProgress({ done: 2, total: 2 });
            }
          }

          if (!disposed && textures.length === 0) {
            throw new Error('所有 Unity 面部贴图均加载失败');
          }
        })().catch((err) => {
          if (disposed) return;
          console.error('[FaceTrackingDemo] 贴图加载失败', err);
          setErrorMessage(err instanceof Error ? err.message : '面部贴图加载失败');
          setStatus('error');
        });

        switchTimer = window.setInterval(() => {
          if (textures.length <= 1) return;
          cursor = (cursor + 1) % textures.length;
          showFace(cursor);
        }, FACE_SWITCH_INTERVAL_MS);
      } catch (err) {
        if (disposed) return;
        console.error('[FaceTrackingDemo] 初始化失败', err);
        setErrorMessage(err instanceof Error ? err.message : '人脸追踪初始化失败');
        setStatus('error');
        cleanup();
      }
    };

    void run();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [cameraRetrySeed]);

  return (
    <div className="face-demo" ref={rootRef}>
      {/* MindAR 渲染容器（内部会创建 video + canvas） */}
      <div ref={containerRef} className="face-demo__stage" />

      {/* 顶部信息条 */}
      <div className="face-demo__hud">
        <button
          type="button"
          className="face-demo__back"
          onClick={handleCancel}
        >
          ← 返回
        </button>
        <div className="face-demo__title">🎭 面部追踪答题 · 看向左右选择</div>
        {status === 'running' && activeLabel ? (
          <div className="face-demo__mask-name">{activeLabel} · yaw {faceYaw.toFixed(2)}</div>
        ) : (
          <div className="face-demo__mask-name" />
        )}
      </div>

      {status === 'running' ? (
        <>
          {DEBUG_EYE_LASER_ORIGIN ? (
            <>
              <span
                className="face-demo-eye-origin face-demo-eye-origin--left"
                style={{ left: `${laserOrigins.left.x}px`, top: `${laserOrigins.left.y}px` }}
                aria-hidden="true"
              />
              <span
                className="face-demo-eye-origin face-demo-eye-origin--right"
                style={{ left: `${laserOrigins.right.x}px`, top: `${laserOrigins.right.y}px` }}
                aria-hidden="true"
              />
            </>
          ) : null}

          {confirmedOption === null && lookOption !== null ? (
            <>
              <div
                className={`face-demo-laser face-demo-laser--${lookOption === 0 ? 'left' : 'right'} face-demo-laser--charge face-demo-laser--eye-left`}
                style={buildLaserStyle(lookOption, holdProgress, 'left')}
                aria-hidden="true"
              >
                <span className="face-demo-laser__beam" />
              </div>
              <div
                className={`face-demo-laser face-demo-laser--${lookOption === 0 ? 'left' : 'right'} face-demo-laser--charge face-demo-laser--eye-right`}
                style={buildLaserStyle(lookOption, holdProgress, 'right')}
                aria-hidden="true"
              >
                <span className="face-demo-laser__beam" />
              </div>
            </>
          ) : null}

          {confirmFx ? (
            <>
              <div
                key={`left-${confirmFx.key}`}
                className={`face-demo-laser face-demo-laser--${confirmFx.side === 0 ? 'left' : 'right'} face-demo-laser--fire face-demo-laser--eye-left`}
                style={buildLaserStyle(confirmFx.side, 1, 'left')}
                aria-hidden="true"
              >
                <span className="face-demo-laser__beam" />
                <span className="face-demo-laser__flash" />
              </div>
              <div
                key={`right-${confirmFx.key}`}
                className={`face-demo-laser face-demo-laser--${confirmFx.side === 0 ? 'left' : 'right'} face-demo-laser--fire face-demo-laser--eye-right`}
                style={buildLaserStyle(confirmFx.side, 1, 'right')}
                aria-hidden="true"
              >
                <span className="face-demo-laser__beam" />
                <span className="face-demo-laser__flash" />
              </div>
            </>
          ) : null}

          <div className="face-demo-question-options">
            {question.options.map((option, index) => {
              const isActive = lookOption === index;
              const isConfirmed = confirmedOption === index;
              const isShattering = isConfirmed;
              const isBlasted = isConfirmed;
              return (
                <button
                  key={`${question.id}-${option.value}`}
                  ref={(el) => {
                    optionButtonRefs.current[index] = el;
                  }}
                  type="button"
                  className={`face-demo-option face-demo-option--${index === 0 ? 'left' : 'right'}${isActive ? ' face-demo-option--active' : ''}${isConfirmed ? ' face-demo-option--confirmed' : ''}${isShattering ? ' face-demo-option--shatter' : ''}${isBlasted ? ' face-demo-option--blasted' : ''}`}
                  style={isActive ? { '--face-select-progress': `${holdProgress * 360}deg` } as CSSProperties : undefined}
                  onClick={() => handleAnswer(option.value)}
                >
                  {isShattering ? (
                    <>
                      <span className="face-demo-option__shard face-demo-option__shard--one" />
                      <span className="face-demo-option__shard face-demo-option__shard--two" />
                      <span className="face-demo-option__shard face-demo-option__shard--three" />
                    </>
                  ) : null}
                  {isBlasted ? (
                    <>
                      <span className="face-demo-option__blast-ring" />
                      <span className="face-demo-option__blast-core" />
                      <span className="face-demo-option__blast-sparks" />
                    </>
                  ) : null}
                  <span className="face-demo-option__index">{index === 0 ? '← 看向左侧选择' : '看向右侧选择 →'}</span>
                  <span className="face-demo-option__label">{option.label}</span>
                  {isConfirmed ? (
                    <span className="face-demo-option__hold">已选择，正在进入下一题…</span>
                  ) : isActive ? (
                    <span className="face-demo-option__hold">保持 1.5 秒确认</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {confirmedOption !== null ? (
            <div className="face-demo-feedback-banner" aria-live="polite">
              已确认：{confirmedOption === 0 ? question.options[0].label : question.options[1].label}
            </div>
          ) : null}

          <div className="face-demo-question-panel">
            <div className="face-demo-question-panel__head">
              <div>
                <div className="face-demo-question-panel__step">第 {currentIdx + 1} 题 / 共 {FACE_QUESTIONS.length} 题</div>
                <div className="face-demo-question-panel__status">{interactionStatus}</div>
              </div>
              <button
                type="button"
                className="face-demo-question-panel__audio"
                onClick={() => readQuestion()}
              >
                重读题目
              </button>
            </div>
            <h2 className="face-demo-question-panel__text">{question.text}</h2>
            <div className="face-demo-question-panel__controls">
              <button type="button" onClick={handlePrevious} disabled={currentIdx === 0}>上一题</button>
              <button type="button" onClick={handleCancel}>返回</button>
            </div>
          </div>
        </>
      ) : null}

      {/* 加载/错误覆盖层 */}
      {status === 'loading' ? (
        <div className="face-demo__overlay">
          <div className="face-demo__spinner" />
          <div className="face-demo__overlay-text">
            正在加载面部贴图与摄像头…
            {loadProgress.total > 0 ? ` (${loadProgress.done}/${loadProgress.total})` : ''}
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="face-demo__overlay">
          <div className="face-demo__overlay-text face-demo__overlay-text--error">
            {errorMessage || '初始化失败'}
          </div>
          <button
            type="button"
            className="face-demo__back face-demo__back--inline"
            onClick={() => {
              setStatus('loading');
              setErrorMessage('');
              setLoadProgress({ done: 0, total: 0 });
              setCameraRetrySeed((seed) => seed + 1);
            }}
          >
            重试摄像头
          </button>
          <button
            type="button"
            className="face-demo__back face-demo__back--inline"
            onClick={handleCancel}
          >
            返回首页
          </button>
        </div>
      ) : null}
    </div>
  );
}
