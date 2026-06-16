import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

type ScanningStageProps = {
  onRetryCamera: () => void;
};

export function ScanningStage({ onRetryCamera }: ScanningStageProps) {
  const setStage = useAppStore((s) => s.setStage);
  const recordScanStart = useAppStore((s) => s.recordScanStart);
  const cvData = useAppStore((s) => s.cvData);
  const poseCount = useAppStore((s) => s.poseLandmarks?.length ?? 0);
  const trackingStatus = useAppStore((s) => s.trackingStatus);
  const trackingError = useAppStore((s) => s.trackingError);
  const hasPose = useAppStore((s) => Boolean(s.poseLandmarks && s.poseLandmarks.length >= 33));
  const hasSubject = hasPose;
  const lockAttentionThreshold = 0.35;
  const [countdown, setCountdown] = useState(3);
  const stableRef = useRef(0);
  const attentionRef = useRef(cvData.attentionScore);
  const hasSubjectRef = useRef(hasSubject);
  const isTrackingError = trackingStatus === 'error' && Boolean(trackingError);
  const minorStatusText = trackingStatus === 'loading'
    ? '轮廓跟踪模型加载中'
    : trackingStatus === 'ready'
      ? hasPose
        ? '轮廓跟踪模型已锁定，正在扫描动作与姿态'
        : '轮廓跟踪模型已就绪，请后退半步并露出肩膀与手臂'
      : trackingStatus === 'error'
        ? `跟踪错误: ${trackingError}`
        : '跟踪待命';

  // 只在首次进入 SCANNING 时记录开始时间
  useEffect(() => {
    recordScanStart();
  }, [recordScanStart]);

  useEffect(() => {
    attentionRef.current = cvData.attentionScore;
    hasSubjectRef.current = hasSubject;
  }, [cvData.attentionScore, hasSubject]);

  // 主体稳定锁定 3s 后自动进入 QUESTIONING
  useEffect(() => {
    const timer = setInterval(() => {
      if (hasSubjectRef.current && attentionRef.current > lockAttentionThreshold) {
        stableRef.current += 1;
        if (stableRef.current >= 3) {
          setStage('QUESTIONING');
        }
        setCountdown(Math.max(0, 3 - stableRef.current));
      } else {
        stableRef.current = 0;
        setCountdown(3);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [lockAttentionThreshold, setStage]);

  return (
    <div className="stage stage-scanning">
      <div className="scanning-overlay">
        <h2 className="scanning-title">SCANNING</h2>
        <p className="scanning-sub">数字形体捕获中</p>
        <p className="scanning-status">
          {hasPose ? '头部/上半身轮廓已捕获' : '等待头部或上半身进入画面'}
        </p>
        <p className="scanning-status scanning-status--minor">{minorStatusText}</p>
        {isTrackingError ? (
          <div className="scanning-alert">
            <p className="scanning-alert__title">摄像头未正常启动</p>
            <p className="scanning-alert__body">{trackingError}</p>
            <button className="btn-scan-retry" type="button" onClick={onRetryCamera}>
              重新启动摄像头
            </button>
          </div>
        ) : null}
        <div className="scanning-actions">
          <button className="btn-scan-retry" type="button" onClick={onRetryCamera}>
            重新启动摄像头
          </button>
          <button className="btn-scan-back" type="button" onClick={() => setStage('STANDBY')}>
            ← 返回
          </button>
        </div>
        <div className="cv-debug">
          <span>SMI {(cvData.smileScore * 100).toFixed(0)}</span>
          <span>MOV {(cvData.movementScore * 100).toFixed(0)}</span>
          <span>ATT {(cvData.attentionScore * 100).toFixed(0)}</span>
          <span>OPN {(cvData.opennessScore * 100).toFixed(0)}</span>
          <span>HEAD {hasPose ? 'ON' : 'OFF'}</span>
          <span>PSE {poseCount}</span>
        </div>
        <p className="hint">
          {hasSubject && cvData.attentionScore > lockAttentionThreshold
            ? `锁定... ${countdown}`
            : '请站在屏幕前方中央，尽量露出肩膀到腰部区域'}
        </p>
      </div>
    </div>
  );
}
