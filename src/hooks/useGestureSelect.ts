/**
 * useGestureSelect - 手指计数选题 Hook
 *
 * 监听 handLandmarks → 计算伸出手指数量 → 维持计时器 → 达到阈值后回调 onSelect(optionIndex)
 * 对外暴露 gestureIndex（当前激活选项，null 表示无）和 holdProgress（0–1 进度）
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { detectGestureOption } from '../cv/gestureDetect';

const HOLD_DURATION_MS = 1500;
const POLL_INTERVAL_MS = 60;
const NEUTRAL_ARM_DURATION_MS = 400;

interface GestureSelectOptions {
  resetKey?: string | number;
}

export function useGestureSelect(onSelect: (optionIndex: number) => void, options: GestureSelectOptions = {}) {
  const handLandmarks = useAppStore((s) => s.handLandmarks);
  const [gestureIndex, setGestureIndex] = useState<number | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isGestureArmed, setIsGestureArmed] = useState(false);

  const landmarksRef = useRef(handLandmarks);
  const onSelectRef  = useRef(onSelect);
  const holdStartRef = useRef<number | null>(null);
  const lastIndexRef = useRef<number | null>(null);
  const neutralSinceRef = useRef<number | null>(null);
  const isArmedRef = useRef(false);

  useEffect(() => { landmarksRef.current = handLandmarks; }, [handLandmarks]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    holdStartRef.current = null;
    lastIndexRef.current = null;
    neutralSinceRef.current = null;
    isArmedRef.current = false;
    setGestureIndex(null);
    setHoldProgress(0);
    setIsGestureArmed(false);
  }, [options.resetKey]);

  useEffect(() => {
    const timer = setInterval(() => {
      const detected = detectGestureOption(landmarksRef.current);

      if (!isArmedRef.current) {
        if (detected === null) {
          if (neutralSinceRef.current === null) {
            neutralSinceRef.current = Date.now();
          }

          if (Date.now() - neutralSinceRef.current >= NEUTRAL_ARM_DURATION_MS) {
            isArmedRef.current = true;
            setIsGestureArmed(true);
          }
        } else {
          neutralSinceRef.current = null;
        }

        holdStartRef.current = null;
        lastIndexRef.current = null;
        if (gestureIndex !== null) setGestureIndex(null);
        if (holdProgress !== 0) setHoldProgress(0);
        return;
      }

      if (detected !== lastIndexRef.current) {
        // 手势切换，重置计时
        lastIndexRef.current = detected;
        holdStartRef.current = detected !== null ? Date.now() : null;
        setGestureIndex(detected);
        setHoldProgress(0);
        return;
      }

      if (detected === null || holdStartRef.current === null) {
        setHoldProgress(0);
        return;
      }

      const elapsed  = Date.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1) {
        onSelectRef.current(detected);
        // 选中后重置，防止连续触发
        holdStartRef.current = null;
        lastIndexRef.current = null;
        neutralSinceRef.current = null;
        isArmedRef.current = false;
        setIsGestureArmed(false);
        setGestureIndex(null);
        setHoldProgress(0);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [gestureIndex, holdProgress]);

  return { gestureIndex, holdProgress, isGestureArmed };
}
