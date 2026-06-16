import { useAppStore } from '../store/useAppStore';
import { useCVCapture } from '../cv/useCVCapture';
import { BodyScanCanvas } from './scanning/BodyScanCanvas';
import { StandbyStage } from './stages/StandbyStage';
import { ScanningStage } from './stages/ScanningStage';
import { QuestioningStage } from './stages/QuestioningStage';
import { GeneratingStage } from './stages/GeneratingStage';
import { ResultStage } from './stages/ResultStage';
import { DialogueStage } from './stages/DialogueStage';
import { TarotStage } from './stages/TarotStage';
import { WaterSimulator } from './demos/WaterSimulator';
import { GumGumHandStretch } from './demos/GumGumHandStretch';
import { FaceTrackingDemo } from './demos/FaceTrackingDemo';

export function StageRouter() {
  const currentStage = useAppStore((s) => s.currentStage);
  const trackingStatus = useAppStore((s) => s.trackingStatus);
  const trackingError = useAppStore((s) => s.trackingError);
  const {
    videoRef,
    startCamera,
    cameraLive,
    cameraActivationState,
    cameraStartAttempts,
    cameraDebugMessage,
    workerReady,
  } = useCVCapture();
  const showCameraPreview = currentStage === 'SCANNING' || currentStage === 'QUESTIONING';
  const isWaterDemo = currentStage === 'WATER_DEMO';
  const isGumGumDemo = currentStage === 'GUMGUM_DEMO';
  // FACE_DEMO 由 MindAR 独立管理摄像头与渲染，不使用共享 video 元素
  const shouldShowCameraRescue = showCameraPreview && !cameraLive;
  const cameraStatusText = trackingStatus === 'error'
    ? trackingError || cameraDebugMessage
    : cameraDebugMessage;

  return (
    <div className="app-container">
      {/* 视频同时用于 CV 捕获和扫描阶段预览 */}
      <video
        ref={videoRef}
        className={
          showCameraPreview
            ? 'camera-video camera-video--active'
            : isWaterDemo
              ? 'camera-video camera-video--pip'
              : isGumGumDemo
                ? 'camera-video'
                : 'camera-video'
        }
        playsInline
        autoPlay
        muted
      />

      {shouldShowCameraRescue ? (
        <div className="camera-rescue-panel">
          <div className="camera-rescue-panel__title">摄像头尚未激活</div>
          <div className="camera-rescue-panel__body">{cameraStatusText}</div>
          <div className="camera-rescue-panel__meta">
            <span>阶段: {currentStage}</span>
            <span>模型: {workerReady ? 'READY' : 'LOADING'}</span>
            <span>相机: {cameraActivationState.toUpperCase()}</span>
            <span>尝试次数: {cameraStartAttempts}</span>
          </div>
          <button className="btn-scan-retry" type="button" onClick={() => void startCamera()}>
            立即激活摄像头
          </button>
        </div>
      ) : null}

      {/* 人形粒子扫描层 */}
      <BodyScanCanvas />

      {/* 阶段路由 */}
      {currentStage === 'STANDBY' && <StandbyStage />}
      {currentStage === 'SCANNING' && <ScanningStage onRetryCamera={() => void startCamera()} />}
      {currentStage === 'QUESTIONING' && <QuestioningStage />}
      {currentStage === 'GENERATING' && <GeneratingStage />}
      {currentStage === 'RESULT' && <ResultStage />}
      {currentStage === 'DIALOGUE' && <DialogueStage />}
      {currentStage === 'TAROT' && <TarotStage />}
      {currentStage === 'WATER_DEMO' && <WaterSimulator />}
      {currentStage === 'GUMGUM_DEMO' && <GumGumHandStretch />}
      {currentStage === 'FACE_DEMO' && <FaceTrackingDemo />}
    </div>
  );
}
