/**
 * CV Hook - 管理摄像头视频流和 WebWorker 通信
 */

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { calcSmile, calcMovement, calcAttention, calcPoseAttention, calcOpenness, smoothCVData } from './features';
import type { CVFeatures } from '../types';

const ENABLE_FACE_LANDMARKS = true;
const ENABLE_FACE_ANALYTICS = false;
const isCameraStageActive = (stage: string, fluidModeActive: boolean) =>
  stage === 'SCANNING' || stage === 'QUESTIONING' || stage === 'WATER_DEMO' || stage === 'GUMGUM_DEMO' || (stage === 'STANDBY' && fluidModeActive);

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return '摄像头权限被拒绝，请在浏览器地址栏允许摄像头后重试';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '未检测到可用摄像头设备';
      case 'NotReadableError':
      case 'TrackStartError':
        return '摄像头可能正被其他应用占用，请关闭后重试';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return '当前摄像头不支持请求参数，请重试';
      case 'SecurityError':
        return '当前页面环境不允许访问摄像头';
      case 'AbortError':
        return '摄像头初始化被中断，请重新启动摄像头';
      default:
        return error.message || '摄像头访问失败';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '摄像头访问失败';
}

export function useCVCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTimeRef = useRef(-1);
  const lastFaceRef = useRef<number[][] | null>(null);
  const lastPoseRef = useRef<number[][] | null>(null);
  const smoothedRef = useRef<CVFeatures>({
    smileScore: 0,
    movementScore: 0,
    attentionScore: 0,
    opennessScore: 0,
  });
  const isReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  const [workerReadyVersion, bumpWorkerReadyVersion] = useReducer((value: number) => value + 1, 0);
  const [workerReady, setWorkerReady] = useState(false);
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraActivationState, setCameraActivationState] = useState<'idle' | 'requesting' | 'streaming' | 'error'>('idle');
  const [cameraStartAttempts, setCameraStartAttempts] = useState(0);
  const [cameraDebugMessage, setCameraDebugMessage] = useState('等待进入需要摄像头的阶段');

  const updateCVData = useAppStore((s) => s.updateCVData);
  const updateFaceLandmarks = useAppStore((s) => s.updateFaceLandmarks);
  const updatePoseLandmarks = useAppStore((s) => s.updatePoseLandmarks);
  const updateHandLandmarks = useAppStore((s) => s.updateHandLandmarks);
  const setTrackingStatus = useAppStore((s) => s.setTrackingStatus);
  const setTrackingError = useAppStore((s) => s.setTrackingError);
  const currentStage = useAppStore((s) => s.currentStage);
  const fluidModeActive = useAppStore((s) => s.fluidModeActive);

  const hasLiveVideoTrack = useCallback(() => {
    return Boolean(
      streamRef.current?.getVideoTracks().some((track) => track.readyState === 'live')
    );
  }, []);

  const attachStreamToVideo = useCallback(async (stream: MediaStream, retryCount: number = 0) => {
    const video = videoRef.current;

    if (!video) {
      if (retryCount < 10) {
        requestAnimationFrame(() => {
          void attachStreamToVideo(stream, retryCount + 1);
        });
      }
      return;
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      if (video.paused) {
        await video.play();
      }
      setCameraLive(true);
      setCameraActivationState('streaming');
      setCameraDebugMessage('摄像头视频流已连接');
    } catch (err) {
      console.error('[CV] Video playback failed:', err);
      throw err;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCameraLive(false);
    setCameraActivationState('idle');
    setCameraDebugMessage('摄像头已停止');
  }, []);

  // 初始化摄像头
  const startCamera = useCallback(async () => {
    try {
      setTrackingError(null);
      setCameraActivationState('requesting');
      setCameraStartAttempts((value) => value + 1);

      if (!isReadyRef.current) {
        console.log('[CV] Worker not ready, starting camera preview first');
        setTrackingStatus('loading');
        setCameraDebugMessage('模型未就绪，先尝试启动摄像头预览');
      } else {
        console.log('[CV] startCamera called, Worker ready:', isReadyRef.current);
        setCameraDebugMessage('正在请求摄像头权限');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setTrackingStatus('error');
        setTrackingError('当前浏览器不支持摄像头访问');
        setCameraActivationState('error');
        setCameraDebugMessage('浏览器环境不支持 getUserMedia');
        return;
      }

      if (streamRef.current) {
        const hasLiveTrack = streamRef.current.getVideoTracks().some((track) => track.readyState === 'live');
        if (hasLiveTrack) {
          console.log('[CV] Stream already exists and is live, reattaching');
          await attachStreamToVideo(streamRef.current);
          setTrackingStatus(isReadyRef.current ? 'ready' : 'loading');
          setCameraDebugMessage('检测到已有 live 摄像头流，正在重新挂载');
          return;
        }

        console.log('[CV] Cleaning up dead stream');
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      console.log('[CV] Starting camera...');
      setCameraDebugMessage('浏览器正在申请摄像头设备');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 24, max: 24 },
          facingMode: 'user',
        },
        audio: false,
      });
      
      const state = useAppStore.getState();
      if (!isCameraStageActive(state.currentStage, state.fluidModeActive)) {
        console.log('[CV] Stage changed during camera startup, stopping stream');
        stream.getTracks().forEach((track) => track.stop());
        setCameraLive(false);
        setCameraActivationState('idle');
        setCameraDebugMessage('阶段已切换，启动中的摄像头流已关闭');
        return;
      }

      streamRef.current = stream;
      await attachStreamToVideo(stream);
      setTrackingStatus(isReadyRef.current ? 'ready' : 'loading');
      console.log('[CV] Camera started successfully');
    } catch (err) {
      console.error('[CV] Camera access failed:', err);
      setTrackingStatus('error');
      const message = getCameraErrorMessage(err);
      setTrackingError(message);
      setCameraLive(false);
      setCameraActivationState('error');
      setCameraDebugMessage(message);
    }
  }, [attachStreamToVideo, setTrackingError, setTrackingStatus]);

  // 初始化 MediaPipe WebWorker
  useEffect(() => {
    setTrackingStatus('loading');
    setTrackingError(null);

    let workerInitTimeout: any = null;
    let isComponentMounted = true;

    setWorkerReady(false);

    console.log('[CV] Creating WebWorker...');
    const worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      if (!isComponentMounted) return;

      const { type, payload, error } = event.data;
      if (type === 'ready') {
        if (workerInitTimeout) clearTimeout(workerInitTimeout);
        isReadyRef.current = true;
        setWorkerReady(true);
        setTrackingStatus(streamRef.current?.getVideoTracks().some((track) => track.readyState === 'live') ? 'ready' : 'loading');
        bumpWorkerReadyVersion();
        console.log('[CV] Worker initialized successfully');
      } else if (type === 'result' && payload) {
        isProcessingRef.current = false;
        const detectedFaceLandmarks = payload.faceLandmarks ?? null;
        const faceLandmarks = ENABLE_FACE_LANDMARKS ? detectedFaceLandmarks : null;
        const poseLandmarks = payload.poseLandmarks ?? null;
        const handLandmarks = payload.handLandmarks ?? null;

        const analyticsFaceLandmarks = ENABLE_FACE_ANALYTICS ? faceLandmarks : null;
        const faceMovement = analyticsFaceLandmarks ? calcMovement(analyticsFaceLandmarks, lastFaceRef.current) : 0;
        const poseMovement = calcMovement(poseLandmarks, lastPoseRef.current);
        const rawSmile = analyticsFaceLandmarks ? calcSmile(analyticsFaceLandmarks) : 0;
        const rawMovement = analyticsFaceLandmarks && poseLandmarks
          ? Math.min(1, faceMovement * 0.4 + poseMovement * 0.6)
          : analyticsFaceLandmarks
            ? faceMovement
            : poseMovement;
        const rawAttention = analyticsFaceLandmarks
          ? calcAttention(analyticsFaceLandmarks)
          : calcPoseAttention(poseLandmarks);
        const rawOpenness = calcOpenness(poseLandmarks);

        const smoothed = smoothCVData(smoothedRef.current, {
          smileScore: rawSmile,
          movementScore: rawMovement,
          attentionScore: rawAttention,
          opennessScore: rawOpenness,
        });

        smoothedRef.current = smoothed;
        updateCVData(smoothed);
        updateFaceLandmarks(faceLandmarks);
        updatePoseLandmarks(poseLandmarks);
        updateHandLandmarks(handLandmarks);
        lastFaceRef.current = faceLandmarks;
        lastPoseRef.current = poseLandmarks;
      } else if (type === 'error') {
        isProcessingRef.current = false;
        if (workerInitTimeout) clearTimeout(workerInitTimeout);
        setTrackingStatus('error');
        setTrackingError(error || 'AI model loading failed');
        console.error('[CV] Worker error:', error);
      }
    };

    worker.onerror = (event) => {
      if (!isComponentMounted) return;
      if (workerInitTimeout) clearTimeout(workerInitTimeout);
      isReadyRef.current = false;
      setWorkerReady(false);
      setTrackingStatus('error');
      setTrackingError('AI model service failed - please refresh the page');
      console.error('[CV] Worker error event:', event.message, event.filename, event.lineno);
    };

    console.log('[CV] Initializing Worker...');
    worker.postMessage({ type: 'init' });

    workerInitTimeout = setTimeout(() => {
      if (isReadyRef.current) return;
      isReadyRef.current = false;
      setWorkerReady(false);
      console.error('[CV] Worker initialization timeout after 60s');
      if (isComponentMounted) {
        setTrackingStatus('error');
        setTrackingError('AI model loading timeout - please check your network connection and refresh');
      }
      try {
        worker.terminate();
      } catch (e) {
        console.error('[CV] Error terminating worker:', e);
      }
      workerRef.current = null;
    }, 60000);

    return () => {
      console.log('[CV] Cleaning up Worker useEffect');
      isComponentMounted = false;
      if (workerInitTimeout) clearTimeout(workerInitTimeout);
      isReadyRef.current = false;
      setWorkerReady(false);
      isProcessingRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      lastFaceRef.current = null;
      lastPoseRef.current = null;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [setTrackingError, setTrackingStatus, updateCVData, updateFaceLandmarks, updatePoseLandmarks, updateHandLandmarks]);

  // 帧循环
  useEffect(() => {
    if (!isCameraStageActive(currentStage, fluidModeActive)) return;

    const sendFrame = () => {
      const video = videoRef.current;
      const worker = workerRef.current;

      if (
        video &&
        worker &&
        isReadyRef.current &&
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTimeRef.current &&
        !isProcessingRef.current
      ) {
        lastVideoTimeRef.current = video.currentTime;
        isProcessingRef.current = true;

        createImageBitmap(video)
          .then((imageBitmap) => {
            if (workerRef.current) {
              workerRef.current.postMessage(
                { type: 'frame', payload: imageBitmap },
                [imageBitmap]
              );
            } else {
              imageBitmap.close();
              isProcessingRef.current = false;
            }
          })
          .catch((err) => {
            console.error('[CV] createImageBitmap failed:', err);
            isProcessingRef.current = false;
          });
      }

      rafRef.current = requestAnimationFrame(sendFrame);
    };

    rafRef.current = requestAnimationFrame(sendFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [currentStage]);

  useEffect(() => {
    console.log('[CV] Stage changed to:', currentStage, 'isReadyRef:', isReadyRef.current);

    if (!isCameraStageActive(currentStage, fluidModeActive)) {
      console.log('[CV] Stopping camera for stage:', currentStage);
      stopCamera();
      return undefined;
    }

    console.log('[CV] Ensuring camera is running for stage:', currentStage);

    let cancelled = false;
    let retryTimeout: number | null = null;
    let attempts = 0;

    const ensureCameraStarted = async () => {
      if (cancelled || hasLiveVideoTrack()) {
        return;
      }

      attempts += 1;
      await startCamera();

      if (!cancelled && !hasLiveVideoTrack() && attempts < 4) {
        retryTimeout = window.setTimeout(() => {
          void ensureCameraStarted();
        }, attempts === 1 ? 320 : 1100);
      }
    };

    void ensureCameraStarted();

    return () => {
      cancelled = true;
      if (retryTimeout !== null) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [currentStage, workerReadyVersion, hasLiveVideoTrack, startCamera, stopCamera]);

  useEffect(() => {
    if (!isCameraStageActive(currentStage, fluidModeActive) || cameraLive) {
      return undefined;
    }

    const handlePointerDown = () => {
      void startCamera();
    };

    window.addEventListener('pointerdown', handlePointerDown, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [cameraLive, currentStage, startCamera]);

  useEffect(() => {
    return () => {
      console.log('[CV] useCVCapture unmounting, cleaning up camera');
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    startCamera,
    cameraLive,
    cameraActivationState,
    cameraStartAttempts,
    cameraDebugMessage,
    workerReady,
  };
}
