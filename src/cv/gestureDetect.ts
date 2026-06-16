/**
 * 手势检测工具 - 基于 Hand Landmarks 计算伸出手指数量
 *
 * 选项映射：
 *   1 根手指 → 选项 0
 *   2 根手指 → 选项 1
 *   3 根手指 → 选项 2
 *   4 根手指 → 选项 3
 *
 * MediaPipe Hand 关键点索引：
 *   食指 tip=8, PIP=6；中指 tip=12, PIP=10；
 *   无名指 tip=16, PIP=14；小指 tip=20, PIP=18
 *
 * 判断：Y 轴朝下，tip.y < pip.y - margin 表示指头伸出
 */

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const EXTEND_MARGIN = 0.02;

/**
 * 计算伸出的非拇指手指数量，映射到选项索引 0–3。
 * 未检测到或手指数不在 1–4 范围内时返回 null。
 */
export function detectGestureOption(handLandmarks: number[][] | null): number | null {
  if (!handLandmarks || handLandmarks.length < 21) return null;

  let count = 0;
  for (let i = 0; i < 4; i++) {
    const tip = handLandmarks[FINGER_TIPS[i]];
    const pip = handLandmarks[FINGER_PIPS[i]];
    if (!tip || !pip) continue;
    if (tip[1] < pip[1] - EXTEND_MARGIN) count++;
  }

  if (count < 1 || count > 4) return null;
  return count - 1; // 1→0, 2→1, 3→2, 4→3
}
