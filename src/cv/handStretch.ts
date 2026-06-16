/**
 * 手指拉伸效果核心逻辑
 * 基于 gum-gum-hand-stretch 项目，使用简化的网格变形和物理模拟
 */

export interface HandLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface StretchState {
  originalPoints: Float32Array;  // 原始手指网格顶点
  deformedPoints: Float32Array;  // 变形后的顶点
  velocity: Float32Array;         // 顶点速度（用于反弹）
  indices: Uint32Array;           // 三角形索引
  isStretching: boolean;
  stretchProgress: number;        // 0-1，拉伸程度
  targetTipPosition: [number, number];  // 拉伸目标位置
  anchorPosition: [number, number];     // 锚点（手掌根部）
}

export interface StretchConfig {
  pinchThresholdEnter: number;   // 开始拉伸的捏合距离阈值
  pinchThresholdExit: number;    // 停止拉伸的捏合距离阈值
  elasticity: number;            // 弹性系数 (0-1)
  damping: number;               // 阻尼系数 (0.95-0.999)
  overshooting: number;          // 过冲效果 (1.0-2.0)
  thinningLength: number;        // 拉伸越长越细的因子
}

export const DEFAULT_STRETCH_CONFIG: StretchConfig = {
  pinchThresholdEnter: 38,
  pinchThresholdExit: 55,
  elasticity: 0.15,
  damping: 0.995,
  overshooting: 1.3,
  thinningLength: 50,
};

/**
 * 计算两点间距离
 */
export function distance(p1: HandLandmark, p2: HandLandmark): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 检测捏合手势（拇指和食指）
 * 返回捏合距离和状态
 */
export function detectPinch(
  handLandmarks: HandLandmark[]
): { distance: number; pinching: boolean; tipPoint: HandLandmark; basePoint: HandLandmark } {
  // MediaPipe 手部关键点：
  // 4 = 拇指尖, 8 = 食指尖, 0 = 手掌中心
  const thumbTip = handLandmarks[4];
  const indexTip = handLandmarks[8];
  const palmBase = handLandmarks[0];  // 手掌中心

  if (!thumbTip || !indexTip) {
    return { distance: Infinity, pinching: false, tipPoint: palmBase, basePoint: palmBase };
  }

  const pinchDist = distance(thumbTip, indexTip);
  const pinching = pinchDist < DEFAULT_STRETCH_CONFIG.pinchThresholdEnter;

  // 被拉伸的是食指尖，锚点是手掌根部或手腕
  return {
    distance: pinchDist,
    pinching,
    tipPoint: indexTip,
    basePoint: palmBase,
  };
}

/**
 * 简化的网格变形（线性插值版本）
 * 实际项目使用 ARAP，这里用简化版本便于 Web 实现
 */
export function deformMesh(
  state: StretchState,
  tipPosition: [number, number],
  basePosition: [number, number],
  config: StretchConfig
): void {
  const original = state.originalPoints;
  const deformed = state.deformedPoints;
  const vel = state.velocity;

  const stretchDir = [
    tipPosition[0] - basePosition[0],
    tipPosition[1] - basePosition[1],
  ];
  const stretchLen = Math.sqrt(stretchDir[0] ** 2 + stretchDir[1] ** 2);
  const stretchDirNorm = [stretchDir[0] / stretchLen, stretchDir[1] / stretchLen];

  // 对每个顶点，根据沿拉伸方向的投影距离来变形
  for (let i = 0; i < original.length; i += 2) {
    const ox = original[i];
    const oy = original[i + 1];

    // 相对于锚点的位置
    const relX = ox - basePosition[0];
    const relY = oy - basePosition[1];


    // 沿拉伸方向的投影
    const proj = relX * stretchDirNorm[0] + relY * stretchDirNorm[1];
    // 垂直于拉伸方向的距离
    const perpX = relX - proj * stretchDirNorm[0];
    const perpY = relY - proj * stretchDirNorm[1];
    const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

    // 拉伸造成的变细
    const thinning = 1.0 / (1 + stretchLen / config.thinningLength);
    const newPerpDist = perpDist * thinning;

    // 重新构建坐标
    let perpNormX = perpX / (perpDist + 0.0001);
    let perpNormY = perpY / (perpDist + 0.0001);

    const newX = basePosition[0] + proj * stretchDirNorm[0] + newPerpDist * perpNormX;
    const newY = basePosition[1] + proj * stretchDirNorm[1] + newPerpDist * perpNormY;

    // 应用物理阻尼和弹性
    vel[i] += (newX - deformed[i]) * config.elasticity;
    vel[i + 1] += (newY - deformed[i + 1]) * config.elasticity;

    vel[i] *= config.damping;
    vel[i + 1] *= config.damping;

    deformed[i] += vel[i];
    deformed[i + 1] += vel[i + 1];
  }
}

/**
 * 松弛回原始形状（反弹效果）
 */
export function relaxMesh(state: StretchState, config: StretchConfig): void {
  const original = state.originalPoints;
  const deformed = state.deformedPoints;
  const vel = state.velocity;

  // 朝向原始位置施加力
  for (let i = 0; i < deformed.length; i += 2) {
    const dx = original[i] - deformed[i];
    const dy = original[i + 1] - deformed[i + 1];

    vel[i] += dx * config.elasticity * 0.5;  // 较弱的恢复力
    vel[i + 1] += dy * config.elasticity * 0.5;

    vel[i] *= config.damping;
    vel[i + 1] *= config.damping;

    deformed[i] += vel[i];
    deformed[i + 1] += vel[i + 1];
  }
}

/**
 * 创建手指网格顶点（简化的圆柱形）
 */
export function createFingerMesh(
  tipPoint: HandLandmark,
  basePoint: HandLandmark,
  radius: number = 10,
  segments: number = 8
): { points: Float32Array; indices: Uint32Array } {
  const points: number[] = [];
  const indices: number[] = [];

  const dirX = tipPoint.x - basePoint.x;
  const dirY = tipPoint.y - basePoint.y;
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  const normX = dirX / len;
  const normY = dirY / len;

  // 垂直方向
  const perpX = -normY;
  const perpY = normX;

  // 基部顶点
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push(
      basePoint.x + (perpX * cos - normX * sin) * radius,
      basePoint.y + (perpY * cos - normY * sin) * radius
    );
  }

  // 顶部顶点
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push(
      tipPoint.x + (perpX * cos - normX * sin) * radius * 0.5,
      tipPoint.y + (perpY * cos - normY * sin) * radius * 0.5
    );
  }

  // 三角形索引
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    // 侧面
    indices.push(i, next, i + segments);
    indices.push(next, next + segments, i + segments);
  }

  // 底部盖
  for (let i = 0; i < segments - 2; i++) {
    indices.push(0, i + 1, i + 2);
  }

  // 顶部盖
  const baseIdx = segments;
  for (let i = 0; i < segments - 2; i++) {
    indices.push(baseIdx, baseIdx + i + 2, baseIdx + i + 1);
  }

  return {
    points: new Float32Array(points),
    indices: new Uint32Array(indices),
  };
}
