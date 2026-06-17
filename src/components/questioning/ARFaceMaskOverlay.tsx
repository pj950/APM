import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useAppStore } from '../../store/useAppStore';

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
  confidence: number;
};

const MIN_FACE_WIDTH = 0.045;
const MIN_FACE_HEIGHT = 0.085;
const MASK_TRANSFORM_HOLD_MS = 600;
const MASK_SCALE_BOOST = 1.38;
const QUESTION_FACE_TEXTURE = `${import.meta.env.BASE_URL}unity-face/textures/cartoon.png`;

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

  return {
    x,
    y,
    width,
    height,
    rollDeg,
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

export function ARFaceMaskOverlay() {
  const currentStage = useAppStore((s) => s.currentStage);
  const faceLandmarks = useAppStore((s) => s.faceLandmarks);
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

  const style = {
    left: `${transform.x}%`,
    top: `${transform.y}%`,
    width: `${transform.width}%`,
    height: `${transform.height}%`,
    opacity: transform.confidence,
    transform: `translate(-50%, -50%) rotate(${transform.rollDeg}deg)`,
  } as CSSProperties;

  return (
    <div className={`ar-face-mask-overlay ar-face-mask-overlay--active${isMirrorSpeaking ? ' ar-face-mask-overlay--speaking' : ''}`} style={style} aria-hidden="true">
      <div className="ar-face-mask-overlay__shell">
        <img className="ar-face-mask-overlay__texture" src={QUESTION_FACE_TEXTURE} alt="" draggable={false} />
        <img className="ar-face-mask-overlay__texture ar-face-mask-overlay__texture--flow" src={QUESTION_FACE_TEXTURE} alt="" draggable={false} />
        <span className="ar-face-mask-overlay__shine" />
      </div>
      <span className="ar-face-mask-overlay__lock" />
    </div>
  );
}