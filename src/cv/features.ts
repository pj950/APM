/**
 * CV 特征提取算法模块
 * 将 MediaPipe 输出的 landmark 坐标数组转化为 0~1 的权重值
 */

/**
 * 计算微笑值
 * 通过对比嘴角距离与眼角距离的比值来判断微笑程度
 * MediaPipe Face Landmarks 索引：
 *   左嘴角 61, 右嘴角 291
 *   左眼外角 33, 右眼外角 263
 *   上嘴唇 13, 下嘴唇 14
 */
export function calcSmile(faceLandmarks: number[][]): number {
  if (!faceLandmarks || faceLandmarks.length < 468) return 0;

  const leftMouth = faceLandmarks[61];
  const rightMouth = faceLandmarks[291];
  const leftEye = faceLandmarks[33];
  const rightEye = faceLandmarks[263];
  const upperLip = faceLandmarks[13];
  const lowerLip = faceLandmarks[14];

  // 嘴角水平距离
  const mouthWidth = Math.sqrt(
    (rightMouth[0] - leftMouth[0]) ** 2 + (rightMouth[1] - leftMouth[1]) ** 2
  );

  // 眼角距离 (作为面部宽度归一化参考)
  const eyeWidth = Math.sqrt(
    (rightEye[0] - leftEye[0]) ** 2 + (rightEye[1] - leftEye[1]) ** 2
  );

  // 嘴唇开合程度
  const lipOpen = Math.sqrt(
    (lowerLip[0] - upperLip[0]) ** 2 + (lowerLip[1] - upperLip[1]) ** 2
  );

  if (eyeWidth === 0) return 0;

  // 嘴宽/眼宽比值 & 嘴唇开合 -> 微笑指标
  const widthRatio = mouthWidth / eyeWidth;
  const openRatio = lipOpen / eyeWidth;

  // 经验值：微笑时嘴宽/眼宽 ≈ 0.8~1.0，不笑时 ≈ 0.5~0.65
  const smileScore = Math.min(1, Math.max(0, (widthRatio - 0.55) / 0.4 + openRatio * 0.3));
  return smileScore;
}

/**
 * 计算活跃度 (两帧之间的肢体位移)
 * 取手腕 (15,16) 和肩膀 (11,12) 的位移差值
 */
export function calcMovement(
  landmarks: number[][] | null,
  lastLandmarks: number[][] | null
): number {
  if (!landmarks || !lastLandmarks) return 0;
  if (landmarks.length === 0 || lastLandmarks.length === 0) return 0;

  // 如果是 face landmarks (468点)
  if (landmarks.length >= 468 && lastLandmarks.length >= 468) {
    // 脸部关键点: 1=鼻尖, 33=左眼外角, 263=右眼外角, 152=下巴
    const indices = [1, 33, 263, 152];
    let totalDelta = 0;
    for (const idx of indices) {
      if (idx >= landmarks.length || idx >= lastLandmarks.length) continue;
      const curr = landmarks[idx];
      const prev = lastLandmarks[idx];
      const dx = curr[0] - prev[0];
      const dy = curr[1] - prev[1];
      totalDelta += Math.sqrt(dx * dx + dy * dy);
    }
    const avgDelta = totalDelta / indices.length;
    // 脸部晃动相对较小，阈值设为 0.05
    return Math.min(1, avgDelta / 0.05);
  }

  // 如果是 pose landmarks (33点)
  if (landmarks.length >= 17 && lastLandmarks.length >= 17) {
    const indices = [11, 12, 15, 16];
    let totalDelta = 0;
    for (const idx of indices) {
      const curr = landmarks[idx];
      const prev = lastLandmarks[idx];
      const dx = curr[0] - prev[0];
      const dy = curr[1] - prev[1];
      totalDelta += Math.sqrt(dx * dx + dy * dy);
    }
    const avgDelta = totalDelta / indices.length;
    return Math.min(1, avgDelta / 0.15);
  }

  return 0;
}

/**
 * 计算注意力 (是否注视屏幕)
 * 通过鼻尖 (1) 与面部中心的偏移判断
 */
export function calcAttention(faceLandmarks: number[][]): number {
  if (!faceLandmarks || faceLandmarks.length < 468) return 0;

  const noseTip = faceLandmarks[1];
  const leftCheek = faceLandmarks[234];
  const rightCheek = faceLandmarks[454];

  // 面部中心 x
  const faceCenterX = (leftCheek[0] + rightCheek[0]) / 2;
  const faceCenterY = (leftCheek[1] + rightCheek[1]) / 2;

  // 鼻尖相对面部中心的偏移
  const offsetX = Math.abs(noseTip[0] - faceCenterX);
  const offsetY = Math.abs(noseTip[1] - faceCenterY);

  // 面部宽度作为归一化基准
  const faceWidth = Math.abs(rightCheek[0] - leftCheek[0]);
  if (faceWidth === 0) return 0;

  const normalizedOffset = (offsetX + offsetY * 0.5) / faceWidth;

  // 偏移越小 -> 注意力越高
  return Math.min(1, Math.max(0, 1 - normalizedOffset * 4));
}

/**
 * 基于 pose 的粗略注意力估计
 * 当脸部未稳定捕获时，退化为判断上半身是否居中面向屏幕
 */
export function calcPoseAttention(poseLandmarks: number[][] | null): number {
  if (!poseLandmarks || poseLandmarks.length < 25) return 0;

  const nose = poseLandmarks[0];
  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftHip = poseLandmarks[23];
  const rightHip = poseLandmarks[24];

  const torsoCenterX = (leftShoulder[0] + rightShoulder[0] + leftHip[0] + rightHip[0]) / 4;
  const shoulderWidth = Math.abs(rightShoulder[0] - leftShoulder[0]);
  const hipWidth = Math.abs(rightHip[0] - leftHip[0]);
  const bodyWidth = Math.max(shoulderWidth, hipWidth, 0.08);

  const centerOffset = Math.abs(torsoCenterX - 0.5) / 0.35;
  const noseOffset = Math.abs(nose[0] - torsoCenterX) / bodyWidth;
  const shoulderLineY = (leftShoulder[1] + rightShoulder[1]) / 2;
  const verticalOffset = Math.abs(nose[1] - shoulderLineY) / Math.max(bodyWidth, 0.08);

  const score = 1 - centerOffset * 0.7 - noseOffset * 0.45 - verticalOffset * 0.08;
  return Math.min(1, Math.max(0, score));
}

/**
 * 计算肢体开放程度
 * 通过双手距离/肩宽比值判断
 */
export function calcOpenness(poseLandmarks: number[][] | null): number {
  if (!poseLandmarks || poseLandmarks.length < 17) return 0.5;

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];
  const leftWrist = poseLandmarks[15];
  const rightWrist = poseLandmarks[16];

  const shoulderWidth = Math.sqrt(
    (rightShoulder[0] - leftShoulder[0]) ** 2 + (rightShoulder[1] - leftShoulder[1]) ** 2
  );

  const wristSpan = Math.sqrt(
    (rightWrist[0] - leftWrist[0]) ** 2 + (rightWrist[1] - leftWrist[1]) ** 2
  );

  if (shoulderWidth === 0) return 0.5;

  // 手腕距离/肩宽: 比值越大，肢体越打开
  const ratio = wristSpan / shoulderWidth;
  return Math.min(1, Math.max(0, (ratio - 0.5) / 2.0));
}

/**
 * 线性插值平滑 (Lerp)
 * 用于消除 CV 数据帧间抖动
 */
export function lerp(current: number, target: number, factor: number = 0.15): number {
  return current + (target - current) * factor;
}

/**
 * 批量平滑 CV 数据
 */
export function smoothCVData(
  current: { smileScore: number; movementScore: number; attentionScore: number; opennessScore: number },
  target: { smileScore: number; movementScore: number; attentionScore: number; opennessScore: number },
  factor: number = 0.15
) {
  return {
    smileScore: lerp(current.smileScore, target.smileScore, factor),
    movementScore: lerp(current.movementScore, target.movementScore, factor),
    attentionScore: lerp(current.attentionScore, target.attentionScore, factor),
    opennessScore: lerp(current.opennessScore, target.opennessScore, factor),
  };
}
