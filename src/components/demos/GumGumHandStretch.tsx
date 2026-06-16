import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useCVCapture } from '../../cv/useCVCapture';
import type { StretchState } from '../../cv/handStretch';
import {
  DEFAULT_STRETCH_CONFIG,
  detectPinch,
  deformMesh,
  relaxMesh,
  createFingerMesh,
  type StretchConfig,
} from '../../cv/handStretch';

export function GumGumHandStretch() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const stretchStateRef = useRef<StretchState | null>(null);
  const configRef = useRef<StretchConfig>({ ...DEFAULT_STRETCH_CONFIG });
  const [debugMode, setDebugMode] = useState(false);
  const [status, setStatus] = useState('初始化中...');

  const { videoRef: srcVideoRef } = useCVCapture();
  const handLandmarks = useAppStore((s: any) => s.handLandmarks);

  // 初始化 Canvas 和拉伸状态
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置 Canvas 大小
    canvas.width = 640;
    canvas.height = 480;

    // 初始化拉伸状态
    const meshData = createFingerMesh(
      { x: 320, y: 200 },
      { x: 320, y: 400 },
      12,
      16
    );

    stretchStateRef.current = {
      originalPoints: meshData.points.slice(),
      deformedPoints: meshData.points.slice(),
      velocity: new Float32Array(meshData.points.length),
      indices: meshData.indices,
      isStretching: false,
      stretchProgress: 0,
      targetTipPosition: [320, 200],
      anchorPosition: [320, 400],
    };

    setStatus('就绪，请捏合手指');
  }, []);

  // 动画循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stretchStateRef.current) return;

    const animate = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 从视频获取摄像头画面
      const videoEl = srcVideoRef.current;
      if (videoEl && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      } else {
        const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        bg.addColorStop(0, '#130a07');
        bg.addColorStop(0.55, '#2f1710');
        bg.addColorStop(1, '#090505');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 微弱热浪点层，避免无摄像头时纯黑
        for (let i = 0; i < 70; i++) {
          const x = (i * 83) % canvas.width;
          const y = (i * 41) % canvas.height;
          const alpha = 0.07 + ((i * 5) % 12) / 100;
          ctx.fillStyle = `rgba(255, 140, 90, ${alpha})`;
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }

      const state = stretchStateRef.current;
      if (!state || !handLandmarks || handLandmarks.length < 21) {
        setStatus('等待手部检测...');
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      // 转换 MediaPipe 坐标（0-1）到 Canvas 坐标
      const landmarks = handLandmarks.map((lm: any) => ({
        x: (typeof lm[0] === 'number' ? lm[0] : 0.5) * canvas.width,
        y: (typeof lm[1] === 'number' ? lm[1] : 0.5) * canvas.height,
      }));

      // 检测捏合
      const { distance: pinchDist, pinching, tipPoint, basePoint } = detectPinch(landmarks);

      if (pinching) {
        state.isStretching = true;
        state.stretchProgress = Math.min(1, state.stretchProgress + 0.15);
        setStatus(`拉伸中... (捏合距离: ${pinchDist.toFixed(1)}px)`);

        // 更新目标位置
        state.targetTipPosition = [tipPoint.x, tipPoint.y];
        state.anchorPosition = [basePoint.x, basePoint.y];

        // 变形网格
        deformMesh(state, state.targetTipPosition, state.anchorPosition, configRef.current);
      } else {
        if (state.isStretching) {
          state.isStretching = false;
          state.stretchProgress = Math.max(0, state.stretchProgress - 0.1);
        }
        // 松弛回原始形状
        relaxMesh(state, configRef.current);
        setStatus(`准备好了 (捏合距离: ${pinchDist.toFixed(1)}px)`);
      }

      // 绘制拉伸的手指
      drawStretchedFinger(ctx, state);
      // 调试信息
      if (debugMode) {
        drawDebugInfo(ctx, state, landmarks, pinchDist, pinching);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [srcVideoRef, handLandmarks, debugMode]);

  return (
    <div style={styles.container}>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
      />
      <div style={styles.panel}>
        <div style={styles.title}>🤏 橡胶手指拉伸效果</div>
        <div style={styles.status}>{status}</div>
        <div style={styles.controls}>
          <button
            style={styles.button}
            onClick={() => setDebugMode(!debugMode)}
          >
            {debugMode ? '❌ 关闭调试' : '🐛 调试模式'}
          </button>
          <button
            style={styles.button}
            onClick={() => useAppStore.setState({ currentStage: 'STANDBY' })}
          >
            ← 返回
          </button>
        </div>
        <div style={styles.hint}>
          💡 使用一只手的拇指和食指捏住另一只手的食指，然后拖动观看拉伸效果
        </div>
      </div>
    </div>
  );
}

/**
 * 绘制变形后的手指
 */
function drawStretchedFinger(
  ctx: CanvasRenderingContext2D,
  state: StretchState
) {
  const { deformedPoints, indices } = state;

  // 创建路径并绘制三角形
  ctx.fillStyle = 'rgba(255, 150, 100, 0.7)';
  ctx.strokeStyle = 'rgba(200, 100, 50, 0.9)';
  ctx.lineWidth = 2;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;

    ctx.beginPath();
    ctx.moveTo(deformedPoints[i0], deformedPoints[i0 + 1]);
    ctx.lineTo(deformedPoints[i1], deformedPoints[i1 + 1]);
    ctx.lineTo(deformedPoints[i2], deformedPoints[i2 + 1]);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();
  }
}

/**
 * 绘制调试信息
 */
function drawDebugInfo(
  ctx: CanvasRenderingContext2D,
  state: StretchState,
  landmarks: Array<{ x: number; y: number }>,
  pinchDist: number,
  pinching: boolean
) {
  // 绘制手部关键点
  ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
  landmarks.forEach((lm) => {
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // 绘制文字信息
  ctx.fillStyle = '#00FF00';
  ctx.font = '14px monospace';
  ctx.fillText(`捏合距离: ${pinchDist.toFixed(1)}px`, 10, 30);
  ctx.fillText(`拉伸进度: ${(state.stretchProgress * 100).toFixed(1)}%`, 10, 50);
  ctx.fillText(`捏合: ${pinching ? '是' : '否'}`, 10, 70);
  ctx.fillText(`锚点: (${state.anchorPosition[0].toFixed(0)}, ${state.anchorPosition[1].toFixed(0)})`, 10, 90);
  ctx.fillText(`目标: (${state.targetTipPosition[0].toFixed(0)}, ${state.targetTipPosition[1].toFixed(0)})`, 10, 110);
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: '100%',
    height: '100%',
    background: 'radial-gradient(circle at 75% 5%, #3a1a10 0%, #1b0c08 45%, #070404 100%)',
    position: 'relative' as const,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  canvas: {
    flex: 1,
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
  },
  panel: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    borderTop: '2px solid #ff6b3b',
    padding: '16px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
  },
  title: {
    fontSize: '18px',
    fontWeight: 'bold' as const,
    color: '#ff6b3b',
    marginBottom: '8px',
  },
  status: {
    fontSize: '14px',
    color: '#aaa',
    marginBottom: '12px',
  },
  controls: {
    display: 'flex',
    gap: '8px',
    marginBottom: '10px',
  },
  button: {
    padding: '6px 12px',
    background: '#ff6b3b',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500' as const,
  },
  hint: {
    fontSize: '12px',
    color: '#888',
    fontStyle: 'italic' as const,
    margin: '0',
  },
};
