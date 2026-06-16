import { useMemo } from 'react';

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function distance(a: number[] | undefined, b: number[] | undefined) {
  if (!a || !b) return 0;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

interface HandGestureState {
  leftFist: number; // 0-1: 握拳程度
  rightFist: number; // 0-1: 握拳程度
  leftOpenness: number; // 0-1: 张开程度
  rightOpenness: number; // 0-1: 张开程度
}

/**
 * 检测手部握拳和张开手掌的动作
 * 基于手指尖到手掌中心的距离
 */
export const useHandGestures = (handLandmarks: any[][] | null): HandGestureState => {
  const gestures = useMemo(() => {
    const result: HandGestureState = {
      leftFist: 0,
      rightFist: 0,
      leftOpenness: 0,
      rightOpenness: 0,
    };

    if (!handLandmarks || handLandmarks.length < 21) return result;

    const calculateFistLevel = (hand: any) => {
      if (!hand || hand.length < 21) return { fist: 0, openness: 0 };

      const palmCenter = hand[9];
      const indexMcp = hand[5];
      const pinkyMcp = hand[17];
      const palmSpan = Math.max(distance(indexMcp, pinkyMcp), 0.06);

      const extendedCount = FINGER_TIPS.reduce((count, tipIndex, idx) => {
        const tip = hand[tipIndex];
        const pip = hand[FINGER_PIPS[idx]];
        if (!tip || !pip) return count;

        const fingerRaised = pip[1] - tip[1] > 0.018;
        const fingerSpread = distance(tip, palmCenter) / palmSpan > 1.02;
        return count + (fingerRaised || fingerSpread ? 1 : 0);
      }, 0);

      const averageSpread = FINGER_TIPS.map((tipIndex) => {
        const tip = hand[tipIndex];
        if (!tip || !palmCenter) return 0;
        return clamp01((distance(tip, palmCenter) / palmSpan - 0.78) / 0.72);
      }).reduce((sum, value) => sum + value, 0) / FINGER_TIPS.length;

      const thumbSpread = clamp01((distance(hand[4], hand[2]) / palmSpan - 0.32) / 0.42);
      const openness = clamp01((extendedCount / 4) * 0.72 + averageSpread * 0.18 + thumbSpread * 0.1);
      const fist = clamp01(1 - openness);

      return { fist, openness };
    };

    const activeHand = calculateFistLevel(handLandmarks);

    // 当前 worker 仅回传单手 landmarks，先将活动手的结果映射到统一字段。
    result.rightFist = activeHand.fist;
    result.leftFist = activeHand.fist;
    result.rightOpenness = activeHand.openness;
    result.leftOpenness = activeHand.openness;

    return result;
  }, [handLandmarks]);

  return gestures;
};
