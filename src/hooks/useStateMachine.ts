/**
 * 状态机 Hook - 管理应用阶段流转和倒计时干预
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

/** RESULT 阶段自动回退超时 (ms) */
const RESULT_TIMEOUT = 30_000;
/** TAROT 阶段自动回退超时 (ms) */
const TAROT_TIMEOUT = 300_000;
/** SCANNING 阶段用户离开检测 */
const LEAVE_DETECTION_THRESHOLD = 0.2;
const LEAVE_DETECTION_DURATION = 3000;

export function useStateMachine() {
  const currentStage = useAppStore((s) => s.currentStage);
  const resetSession = useAppStore((s) => s.resetSession);
  const setStage = useAppStore((s) => s.setStage);
  const hasPose = useAppStore((s) => Boolean(s.poseLandmarks && s.poseLandmarks.length >= 33));
  const attentionScore = useAppStore((s) => s.cvData.attentionScore);
  const lastActivityRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const leaveCounterRef = useRef(0);

  // 记录最近活动时间
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // 自动离开检测 (SCANNING 阶段)
  useEffect(() => {
    if (currentStage !== 'SCANNING') {
      leaveCounterRef.current = 0;
      return;
    }

    if (!hasPose || attentionScore < LEAVE_DETECTION_THRESHOLD) {
      leaveCounterRef.current += 500;
      if (leaveCounterRef.current >= LEAVE_DETECTION_DURATION) {
        setStage('STANDBY');
        leaveCounterRef.current = 0;
      }
    } else {
      leaveCounterRef.current = 0;
    }
  }, [currentStage, hasPose, attentionScore, setStage]);

  // 阶段超时监控
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (currentStage === 'QUESTIONING') {
      // 问答阶段不自动超时，避免用户在作答过程中被强制退出。
      lastActivityRef.current = Date.now();
    } else if (currentStage === 'RESULT') {
      const enterTime = Date.now();
      timerRef.current = setInterval(() => {
        if (Date.now() - enterTime > RESULT_TIMEOUT) {
          resetSession();
        }
      }, 1000);
    } else if (currentStage === 'TAROT') {
      const enterTime = Date.now();
      timerRef.current = setInterval(() => {
        if (Date.now() - enterTime > TAROT_TIMEOUT) {
          resetSession();
        }
      }, 5000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentStage, resetSession]);

  return { recordActivity };
}

/**
 * 状态机流转规则:
 * STANDBY -> SCANNING: 用户靠近 / 点击开始
 * SCANNING -> QUESTIONING: 面部检测成功稳定 3s
 * QUESTIONING -> GENERATING: 答完所有问题 / 触发生成
 * GENERATING -> RESULT: LLM 返回完成
 * RESULT -> STANDBY: 超时 30s 自动回退 / 用户点击
 * 任何阶段 -> STANDBY: 超时无活动 / 用户离开
 */
