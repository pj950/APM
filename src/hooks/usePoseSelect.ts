import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

const HOLD_DURATION_MS = 1200;
const POLL_INTERVAL_MS = 60;
const NEUTRAL_ARM_DURATION_MS = 520;
const WRIST_RAISE_MARGIN = 0.11;
const ELBOW_RAISE_MARGIN = 0.05;
const DUAL_RAISE_DIFF_MARGIN = 0.07;
const HOLD_LOSS_GRACE_MS = 180;
const DETECTION_STABLE_MS = 180;
const POSE_MIN_VISIBILITY = 0.45;
const NEUTRAL_WRIST_DROP_MARGIN = 0.03;
const NEUTRAL_ELBOW_DROP_MARGIN = 0.015;

interface PoseSelectOptions {
  resetKey?: string | number;
}

export type PoseSelectionPhase = 'arming' | 'ready' | 'selecting';

function pointVisible(point: number[] | undefined | null): point is number[] {
  if (!point || point.length < 2) return false;
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
  if (point.length >= 4 && Number.isFinite(point[3])) {
    return point[3] >= POSE_MIN_VISIBILITY;
  }
  return true;
}

function detectRaisedSide(poseLandmarks: number[][] | null): 0 | 1 | null {
  if (!poseLandmarks || poseLandmarks.length < 17) return null;

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftElbow = poseLandmarks[13];
  const rightElbow = poseLandmarks[14];
  const leftWrist = poseLandmarks[15];
  const rightWrist = poseLandmarks[16];

  if (
    !pointVisible(leftShoulder) ||
    !pointVisible(rightShoulder) ||
    !pointVisible(leftElbow) ||
    !pointVisible(rightElbow) ||
    !pointVisible(leftWrist) ||
    !pointVisible(rightWrist)
  ) {
    return null;
  }

  const leftLift = leftShoulder[1] - leftWrist[1];
  const rightLift = rightShoulder[1] - rightWrist[1];
  const leftElbowLift = leftShoulder[1] - leftElbow[1];
  const rightElbowLift = rightShoulder[1] - rightElbow[1];

  const leftRaised =
    leftLift > WRIST_RAISE_MARGIN &&
    leftElbowLift > ELBOW_RAISE_MARGIN &&
    leftWrist[1] < leftElbow[1] - 0.015;

  const rightRaised =
    rightLift > WRIST_RAISE_MARGIN &&
    rightElbowLift > ELBOW_RAISE_MARGIN &&
    rightWrist[1] < rightElbow[1] - 0.015;

  if (leftRaised && !rightRaised) return 0;
  if (rightRaised && !leftRaised) return 1;

  if (leftRaised && rightRaised) {
    if (Math.abs(leftLift - rightLift) < DUAL_RAISE_DIFF_MARGIN) return null;
    return leftLift > rightLift ? 0 : 1;
  }

  return null;
}

function isNeutralPose(poseLandmarks: number[][] | null): boolean {
  if (!poseLandmarks || poseLandmarks.length < 17) return false;

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftElbow = poseLandmarks[13];
  const rightElbow = poseLandmarks[14];
  const leftWrist = poseLandmarks[15];
  const rightWrist = poseLandmarks[16];

  if (
    !pointVisible(leftShoulder) ||
    !pointVisible(rightShoulder) ||
    !pointVisible(leftElbow) ||
    !pointVisible(rightElbow) ||
    !pointVisible(leftWrist) ||
    !pointVisible(rightWrist)
  ) {
    return false;
  }

  const leftWristDropped = leftWrist[1] - leftShoulder[1] > NEUTRAL_WRIST_DROP_MARGIN;
  const rightWristDropped = rightWrist[1] - rightShoulder[1] > NEUTRAL_WRIST_DROP_MARGIN;
  const leftElbowDropped = leftElbow[1] - leftShoulder[1] > NEUTRAL_ELBOW_DROP_MARGIN;
  const rightElbowDropped = rightElbow[1] - rightShoulder[1] > NEUTRAL_ELBOW_DROP_MARGIN;

  return leftWristDropped && rightWristDropped && leftElbowDropped && rightElbowDropped;
}

export function usePoseSelect(onSelect: (optionIndex: 0 | 1) => void, options: PoseSelectOptions = {}) {
  const poseLandmarks = useAppStore((state) => state.poseLandmarks);
  const [gestureIndex, setGestureIndex] = useState<0 | 1 | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isPoseArmed, setIsPoseArmed] = useState(false);

  const landmarksRef = useRef(poseLandmarks);
  const onSelectRef = useRef(onSelect);
  const holdStartRef = useRef<number | null>(null);
  const detectedSinceRef = useRef<number | null>(null);
  const lastIndexRef = useRef<0 | 1 | null>(null);
  const neutralSinceRef = useRef<number | null>(null);
  const lostGestureSinceRef = useRef<number | null>(null);
  const isArmedRef = useRef(false);
  const gestureIndexRef = useRef<0 | 1 | null>(null);
  const holdProgressRef = useRef(0);

  useEffect(() => {
    landmarksRef.current = poseLandmarks;
  }, [poseLandmarks]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    gestureIndexRef.current = gestureIndex;
  }, [gestureIndex]);

  useEffect(() => {
    holdProgressRef.current = holdProgress;
  }, [holdProgress]);

  useEffect(() => {
    holdStartRef.current = null;
    detectedSinceRef.current = null;
    lastIndexRef.current = null;
    neutralSinceRef.current = null;
    lostGestureSinceRef.current = null;
    isArmedRef.current = false;
    gestureIndexRef.current = null;
    holdProgressRef.current = 0;
    setGestureIndex(null);
    setHoldProgress(0);
    setIsPoseArmed(false);
  }, [options.resetKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const pose = landmarksRef.current;
      const detected = detectRaisedSide(pose);
      let effectiveDetected = detected;

      if (detected === null && lastIndexRef.current !== null && holdStartRef.current !== null) {
        if (lostGestureSinceRef.current === null) {
          lostGestureSinceRef.current = Date.now();
        }

        if (Date.now() - lostGestureSinceRef.current <= HOLD_LOSS_GRACE_MS) {
          effectiveDetected = lastIndexRef.current;
        }
      } else {
        lostGestureSinceRef.current = null;
      }

      if (!isArmedRef.current) {
        if (isNeutralPose(pose)) {
          if (neutralSinceRef.current === null) {
            neutralSinceRef.current = Date.now();
          }

          if (Date.now() - neutralSinceRef.current >= NEUTRAL_ARM_DURATION_MS) {
            isArmedRef.current = true;
            setIsPoseArmed(true);
          }
        } else {
          neutralSinceRef.current = null;
        }

        holdStartRef.current = null;
        detectedSinceRef.current = null;
        lastIndexRef.current = null;
        lostGestureSinceRef.current = null;
        if (gestureIndexRef.current !== null) {
          gestureIndexRef.current = null;
          setGestureIndex(null);
        }
        if (holdProgressRef.current !== 0) {
          holdProgressRef.current = 0;
          setHoldProgress(0);
        }
        return;
      }

      if (effectiveDetected !== lastIndexRef.current) {
        lastIndexRef.current = effectiveDetected;
        detectedSinceRef.current = effectiveDetected !== null ? Date.now() : null;
        holdStartRef.current = null;
        lostGestureSinceRef.current = null;
        if (gestureIndexRef.current !== effectiveDetected) {
          gestureIndexRef.current = effectiveDetected;
          setGestureIndex(effectiveDetected);
        }
        if (holdProgressRef.current !== 0) {
          holdProgressRef.current = 0;
          setHoldProgress(0);
        }
        return;
      }

      if (effectiveDetected === null) {
        detectedSinceRef.current = null;
        holdStartRef.current = null;
        if (holdProgressRef.current !== 0) {
          holdProgressRef.current = 0;
          setHoldProgress(0);
        }
        return;
      }

      if (holdStartRef.current === null) {
        if (detectedSinceRef.current === null) {
          detectedSinceRef.current = Date.now();
          return;
        }
        if (Date.now() - detectedSinceRef.current < DETECTION_STABLE_MS) {
          return;
        }
        holdStartRef.current = Date.now();
      }

      const progress = Math.min((Date.now() - holdStartRef.current) / HOLD_DURATION_MS, 1);
      if (Math.abs(progress - holdProgressRef.current) >= 0.01) {
        holdProgressRef.current = progress;
        setHoldProgress(progress);
      }

      if (progress >= 1) {
        onSelectRef.current(effectiveDetected);
        holdStartRef.current = null;
        detectedSinceRef.current = null;
        lastIndexRef.current = null;
        neutralSinceRef.current = null;
        lostGestureSinceRef.current = null;
        isArmedRef.current = false;
        gestureIndexRef.current = null;
        holdProgressRef.current = 0;
        setIsPoseArmed(false);
        setGestureIndex(null);
        setHoldProgress(0);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  const selectionPhase: PoseSelectionPhase = gestureIndex !== null || holdProgress > 0
    ? 'selecting'
    : isPoseArmed
      ? 'ready'
      : 'arming';

  return { gestureIndex, holdProgress, isPoseArmed, selectionPhase };
}