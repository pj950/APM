/**
 * TarotStage - 塔罗牌阶段
 *
 * 将 ai-tarot-oracle 的静态文件嵌入至 /tarot/index.html（放在 public/tarot/）。
 * DeepSeek API 由 vite.config.ts 的 tarotApiPlugin 在同端口拦截，无需额外服务器。
 *
 * 使用前准备：
 *   1. 将 ai-tarot-oracle 项目的 index.html 复制到 public/tarot/index.html
 *   2. 将 assets/ 目录复制到 public/tarot/assets/
 *   3. 将 tarot-card-back.jpg 复制到 public/tarot/tarot-card-back.jpg
 *   4. 在 public/tarot/index.html 中把 proxyURL 改为 '/api/tarot-reading'
 *   5. 在 .env 中配置 DEEPSEEK_API_KEY=sk-...
 *
 * 点击右上角 ✕ 或等待 5 分钟无操作后自动回到 STANDBY。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

declare global {
  interface Window {
    __ensureTarotCameraStream?: () => Promise<MediaStream>;
  }
}

const TAROT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 320, max: 640 },
    height: { ideal: 240, max: 480 },
    frameRate: { ideal: 15, max: 24 },
    facingMode: 'user',
  },
  audio: false,
};
// 摄像头空闲多久后才真正释放：只要在这段时间内再次进入塔罗，就复用同一条已授权的流，避免反复弹窗/选择摄像头。
const SHARED_STREAM_IDLE_MS = 4 * 60 * 1000;

// 持久化在模块作用域：即使 TarotStage 组件在离开/进入 TAROT 阶段时反复卸载重挂，
// 这条已授权的摄像头流也会保留，供同源 iframe 复用，从而“授权一次，之后进出不再弹窗”。
let sharedTarotStream: MediaStream | null = null;
let sharedStreamIdleTimer: number | null = null;

function hasLiveVideo(stream: MediaStream | null): stream is MediaStream {
  return Boolean(stream && stream.getVideoTracks().some((track) => track.readyState === 'live'));
}

async function ensureSharedTarotStream(): Promise<MediaStream> {
  if (hasLiveVideo(sharedTarotStream)) return sharedTarotStream;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持摄像头访问');
  }
  sharedTarotStream = await navigator.mediaDevices.getUserMedia(TAROT_CAMERA_CONSTRAINTS);
  return sharedTarotStream;
}

function stopSharedTarotStream() {
  if (sharedTarotStream) {
    sharedTarotStream.getTracks().forEach((track) => track.stop());
    sharedTarotStream = null;
  }
}

function cancelSharedStreamIdleStop() {
  if (sharedStreamIdleTimer !== null) {
    window.clearTimeout(sharedStreamIdleTimer);
    sharedStreamIdleTimer = null;
  }
}

function scheduleSharedStreamIdleStop() {
  cancelSharedStreamIdleStop();
  sharedStreamIdleTimer = window.setTimeout(() => {
    stopSharedTarotStream();
  }, SHARED_STREAM_IDLE_MS);
}

export function TarotStage() {
  const resetSession = useAppStore((s) => s.resetSession);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [entryNonce, setEntryNonce] = useState(() => Date.now());

  const handleClose = useCallback(() => {
    resetSession();
  }, [resetSession]);

  useEffect(() => {
    let disposed = false;
    // 把“获取共享摄像头流”的能力暴露给同源 iframe：iframe 不再自己反复 getUserMedia，
    // 而是复用父窗口这条持久流，实现授权一次、之后进出不再弹窗/选摄像头。
    window.__ensureTarotCameraStream = ensureSharedTarotStream;
    cancelSharedStreamIdleStop();
    setFrameReady(false);
    setEntryNonce(Date.now());

    const timerId = window.setTimeout(() => {
      if (disposed) return;
      setFrameReady(true);
    }, 120);

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      // 离开塔罗不立刻停摄像头，改为空闲计时释放；短时间内再次进入会直接复用同一条已授权流。
      scheduleSharedStreamIdleStop();
    };
  }, []);

  return (
    <div className="stage stage-tarot">
      <button
        className="stage-tarot__close"
        type="button"
        onClick={handleClose}
        aria-label="退出塔罗，返回主界面"
      >
        ✕
      </button>

      {frameReady ? (
        <iframe
          ref={iframeRef}
          className="stage-tarot__frame"
          src={`/tarot/index.html?entry=${entryNonce}`}
          title="AI 塔罗星阵"
          allow="camera *; microphone *"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="stage-tarot__loading">正在准备摄像头与塔罗场景...</div>
      )}
    </div>
  );
}
