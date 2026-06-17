import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useAppStore } from '../../store/useAppStore';
import type { VisualArchetype, VoicePresetKey } from '../../types';
import { MirrorFaceFallback, ScenePreset, resolveMaskKey } from '../dialogue/MirrorFace';
import { createBestEffortWebGLRenderer, WebGLCanvasGuard } from '../WebGLCanvasGuard';

const VOICE_MASK_MAP: Record<VoicePresetKey, VisualArchetype['baseType']> = {
  gollum: 'Flora',
  robot: 'Plasma',
  ethereal: 'Nebula',
  deep: 'Singularity',
  crystal: 'Crystal',
};

type Point2D = {
  x: number;
  y: number;
};

type FaceMaskTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rollDeg: number;
  yaw: number;
  pitch: number;
  confidence: number;
};

const MIN_FACE_WIDTH = 0.045;
const MIN_FACE_HEIGHT = 0.085;
const MASK_TRANSFORM_HOLD_MS = 600;
const MASK_SCALE_BOOST = 1.25;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPoint(landmarks: number[][] | null, index: number): Point2D | null {
  if (!landmarks || index >= landmarks.length) return null;
  const point = landmarks[index];
  if (!point) return null;
  return { x: point[0], y: point[1] };
}

function averagePoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function distance(a: Point2D, b: Point2D) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeFaceMaskTransform(landmarks: number[][] | null): FaceMaskTransform | null {
  const nose = getPoint(landmarks, 1);
  const forehead = getPoint(landmarks, 10);
  const chin = getPoint(landmarks, 152);
  const leftEye = getPoint(landmarks, 33);
  const rightEye = getPoint(landmarks, 263);
  const mouthLeft = getPoint(landmarks, 61);
  const mouthRight = getPoint(landmarks, 291);
  const leftCheek = getPoint(landmarks, 234);
  const rightCheek = getPoint(landmarks, 454);

  if (!nose || !forehead || !chin || !leftEye || !rightEye || !mouthLeft || !mouthRight || !leftCheek || !rightCheek) {
    return null;
  }

  const eyeCenter = averagePoint(leftEye, rightEye);
  const mouthCenter = averagePoint(mouthLeft, mouthRight);
  const cheekCenter = averagePoint(leftCheek, rightCheek);
  const faceCenter = averagePoint(eyeCenter, mouthCenter);

  const cheekWidth = distance(leftCheek, rightCheek);
  const faceHeight = distance(forehead, chin);

  const normalizedFaceWidth = Math.max(cheekWidth, MIN_FACE_WIDTH);
  const normalizedFaceHeight = Math.max(faceHeight, MIN_FACE_HEIGHT);

  const x = clamp(faceCenter.x * 100, 5, 95);
  const y = clamp(faceCenter.y * 100, 5, 95);
  const width = clamp(normalizedFaceWidth * 100 * 2.2 * MASK_SCALE_BOOST, 20, 98);
  const height = clamp(normalizedFaceHeight * 100 * 2.0 * MASK_SCALE_BOOST, 25, 98);
  const rollDeg = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

  const faceHalfWidth = Math.max(Math.abs(rightCheek.x - leftCheek.x) * 0.5, 0.001);
  const yaw = clamp((cheekCenter.x - nose.x) / faceHalfWidth, -1, 1) * 0.82;

  const eyeToMouth = Math.max(mouthCenter.y - eyeCenter.y, 0.001);
  const pitchRatio = (nose.y - eyeCenter.y) / eyeToMouth;
  const pitch = clamp((pitchRatio - 0.54) * 2.35, -0.58, 0.58);

  return {
    x,
    y,
    width,
    height,
    rollDeg,
    yaw,
    pitch,
    confidence: clamp(
      Math.min(
        (normalizedFaceWidth - MIN_FACE_WIDTH) / 0.11,
        (normalizedFaceHeight - MIN_FACE_HEIGHT) / 0.16,
      ),
      0.28,
      1,
    ),
  };
}

function TrackedMaskScene({
  maskKey,
  isSpeaking,
  pitch,
  yaw,
}: {
  maskKey: ReturnType<typeof resolveMaskKey>;
  isSpeaking: boolean;
  pitch: number;
  yaw: number;
}) {
  const { viewport } = useThree();
  const fillFactor = 0.95; // 占容器宽度的95%，最大化脸部覆盖范围
  const scaleFactor = (viewport.width / 1.5) * fillFactor;

  return (
    <>
      <ambientLight intensity={0.54} />
      <pointLight position={[5, 5, 5]} intensity={1.46} />
      <group position={[0, -0.05, 0]} rotation={[pitch, yaw, 0]} scale={[scaleFactor, scaleFactor * 1.05, scaleFactor]}>
        <ScenePreset maskKey={maskKey} isSpeaking={isSpeaking} motionMode="tracked" hideHood />
      </group>
    </>
  );
}

export function ARFaceMaskOverlay() {
  const currentStage = useAppStore((s) => s.currentStage);
  const faceLandmarks = useAppStore((s) => s.faceLandmarks);
  const voicePreset = useAppStore((s) => s.voicePreset);
  const isMirrorSpeaking = useAppStore((s) => s.isMirrorSpeaking);
  const lastStableTransformRef = useRef<FaceMaskTransform | null>(null);
  const lastStableTransformAtRef = useRef(0);

  const rawTransform = useMemo(() => computeFaceMaskTransform(faceLandmarks), [faceLandmarks]);

  useEffect(() => {
    if (!rawTransform) return;

    lastStableTransformRef.current = rawTransform;
    lastStableTransformAtRef.current = performance.now();
  }, [rawTransform]);

  const transform = rawTransform ?? (() => {
    const lastStableTransform = lastStableTransformRef.current;
    if (!lastStableTransform) {
      return null;
    }

    if (performance.now() - lastStableTransformAtRef.current > MASK_TRANSFORM_HOLD_MS) {
      return null;
    }

    return {
      ...lastStableTransform,
      confidence: Math.max(lastStableTransform.confidence * 0.74, 0.24),
    };
  })();

  if (currentStage !== 'QUESTIONING' || !transform) {
    return null;
  }

  const baseType = VOICE_MASK_MAP[voicePreset] || 'Crystal';
  const maskKey = resolveMaskKey(baseType);
  const style = {
    left: `${transform.x}%`,
    top: `${transform.y}%`,
    width: `${transform.width}%`,
    height: `${transform.height}%`,
    opacity: transform.confidence,
    transform: `translate(-50%, -50%) rotate(${transform.rollDeg}deg)`,
  } as CSSProperties;

  return (
    <div className="ar-face-mask-overlay ar-face-mask-overlay--active" style={style} aria-hidden="true">
      <div className="ar-face-mask-overlay__shell">
        <WebGLCanvasGuard
          fallback={(
            <div className="ar-face-mask-overlay__fallback">
              <MirrorFaceFallback baseType={baseType} isSpeaking={isMirrorSpeaking} />
            </div>
          )}
        >
          <Canvas
            camera={{ position: [0, 0, 2.45], fov: 46 }}
            gl={(canvas) => createBestEffortWebGLRenderer(canvas as HTMLCanvasElement)}
            dpr={[1, 1.25]}
            style={{ width: '100%', height: '100%', background: 'transparent' }}
          >
            <TrackedMaskScene maskKey={maskKey} isSpeaking={isMirrorSpeaking} pitch={transform.pitch} yaw={transform.yaw} />
          </Canvas>
        </WebGLCanvasGuard>
      </div>
      <span className="ar-face-mask-overlay__lock" />
    </div>
  );
}