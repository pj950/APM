/**
 * QuestioningStage - 6 维度性格测试（二选一）
 *
 * 每题对应一个维度的二元选择
 */

import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useStateMachine } from '../../hooks/useStateMachine';
import { usePoseSelect } from '../../hooks/usePoseSelect';
import { speakWithPreset, stopSpeaking, prefetchTTS, VOICE_PRESETS } from '../../services/tts';
import type { PersonalityDimensions, VoicePresetKey } from '../../types';

interface Question {
  id: string;
  text: string;
  dimensionKey: keyof PersonalityDimensions;
  options: [
    { label: string; value: 0 },
    { label: string; value: 1 }
  ];
}

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    text: '如果你的微信钱包会说话，它最可能对你发出什么嘲笑？',
    dimensionKey: 'capital',
    options: [
      { label: '💸 “吃土吃出米其林质感”', value: 0 },
      { label: '🤑 “呼吸都在狂吸GDP”', value: 1 },
    ],
  },
  {
    id: 'q2',
    text: '深夜emo时，你的灵魂通常会漂向哪个终极归宿？',
    dimensionKey: 'spirit',
    options: [
      { label: '🧘 “电子木鱼敲到冒烟”', value: 0 },
      { label: '🍾 “接着奏乐接着舞”', value: 1 },
    ],
  },
  {
    id: 'q3',
    text: '你的大脑在面对高数或复杂说明书时会如何运转？',
    dimensionKey: 'intellect',
    options: [
      { label: '🤪 “脑干缺失，眼神清澈”', value: 0 },
      { label: '🧠 “量子纠缠，学术风暴”', value: 1 },
    ],
  },
  {
    id: 'q4',
    text: '如果必须去参加一个陌生人的社交派对，你会？',
    dimensionKey: 'social',
    options: [
      { label: '🦪 “自闭贝壳，角落抠地”', value: 0 },
      { label: '🦋 “社牛附体，全场聊遍”', value: 1 },
    ],
  },
  {
    id: 'q5',
    text: '看到一张歪了2毫米的画，或者手机上未读的小红点？',
    dimensionKey: 'order',
    options: [
      { label: '🌪 “随缘摆烂，混沌自在”', value: 0 },
      { label: '📐 “像素对齐，逼死强迫”', value: 1 },
    ],
  },
  {
    id: 'q6',
    text: '周末早晨醒来，你全身的电量和生命体征呈现什么状态？',
    dimensionKey: 'energy',
    options: [
      { label: '🔋 “省电咸鱼，安祥躺平”', value: 0 },
      { label: '⚡ “发电机转世，不知疲倦”', value: 1 },
    ],
  },
];

const QUESTION_READING_DELAY_MS = 50;

const VOICE_PRESET_KEYS = Object.keys(VOICE_PRESETS) as VoicePresetKey[];

function pickRandomVoicePreset(current?: VoicePresetKey): VoicePresetKey {
  const candidates = VOICE_PRESET_KEYS.filter((key) => key !== current);
  const pool = candidates.length > 0 ? candidates : VOICE_PRESET_KEYS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function clampOverlayValue(value: number, min: number = 4, max: number = 96) {
  return Math.max(min, Math.min(max, value));
}

function toMirroredOverlayPoint(landmarks: number[][] | null, index: number) {
  if (!landmarks || index >= landmarks.length) return null;

  const point = landmarks[index];
  if (!point) return null;

  return {
    x: clampOverlayValue((1 - point[0]) * 100),
    y: clampOverlayValue(point[1] * 100, 6, 94),
  };
}

function toPolyline(points: Array<{ x: number; y: number } | null>) {
  const normalized = points.filter((point): point is { x: number; y: number } => Boolean(point));
  if (normalized.length < 2) return null;
  return normalized.map((point) => `${point.x},${point.y}`).join(' ');
}

function QuestionArmOverlay({
  poseLandmarks,
  activeSide,
  isPoseArmed,
}: {
  poseLandmarks: number[][] | null;
  activeSide: 0 | 1 | null;
  isPoseArmed: boolean;
}) {
  const leftShoulder = toMirroredOverlayPoint(poseLandmarks, 11);
  const leftElbow = toMirroredOverlayPoint(poseLandmarks, 13);
  const leftWrist = toMirroredOverlayPoint(poseLandmarks, 15);
  const rightShoulder = toMirroredOverlayPoint(poseLandmarks, 12);
  const rightElbow = toMirroredOverlayPoint(poseLandmarks, 14);
  const rightWrist = toMirroredOverlayPoint(poseLandmarks, 16);

  const leftDetectedPath = toPolyline([leftShoulder, leftElbow, leftWrist]);
  const rightDetectedPath = toPolyline([rightShoulder, rightElbow, rightWrist]);

  return (
    <div className="question-camera-guides" aria-hidden="true">
      <svg className="question-arm-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          className={`arm-guide-line arm-guide-line--left${isPoseArmed ? ' arm-guide-line--armed' : ''}${activeSide === 0 ? ' arm-guide-line--active' : ''}`}
          points="18,78 16,58 14,30"
        />
        <polyline
          className={`arm-guide-line arm-guide-line--right${isPoseArmed ? ' arm-guide-line--armed' : ''}${activeSide === 1 ? ' arm-guide-line--active' : ''}`}
          points="82,78 84,58 86,30"
        />

        {leftDetectedPath ? (
          <polyline
            className={`arm-detected-line${activeSide === 0 ? ' arm-detected-line--active' : ''}`}
            points={leftDetectedPath}
          />
        ) : null}

        {rightDetectedPath ? (
          <polyline
            className={`arm-detected-line${activeSide === 1 ? ' arm-detected-line--active' : ''}`}
            points={rightDetectedPath}
          />
        ) : null}
      </svg>
    </div>
  );
}

function toSpeechLabel(label: string) {
  // 只保留中文、字母、数字，用于清晰的TTS语音朗读
  return label.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim();
}

export function QuestioningStage() {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<(0 | 1)[]>(Array(6).fill(-1));
  
  const triggerGeneration = useAppStore((s) => s.triggerGeneration);
  const setStage = useAppStore((s) => s.setStage);
  const removeLastQAAnswer = useAppStore((s) => s.removeLastQAAnswer);
  const poseLandmarks = useAppStore((s) => s.poseLandmarks);
  const voicePreset = useAppStore((s) => s.voicePreset);
  const isMirrorSpeaking = useAppStore((s) => s.isMirrorSpeaking);
  const setVoicePreset = useAppStore((s) => s.setVoicePreset);
  const setMirrorSpeaking = useAppStore((s) => s.setMirrorSpeaking);

  const { recordActivity } = useStateMachine();
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const question = QUESTIONS[currentIdx];
  const activeVoicePresetName = VOICE_PRESETS[voicePreset]?.name || '未知音色';

  // 预先生成每一道题目的随机音色，防止读题中途网络波动及音色突变，并用于后台并行预下载解码
  const [presets] = useState<VoicePresetKey[]>(() => {
    const list: VoicePresetKey[] = [];
    let current: VoicePresetKey | undefined = undefined;
    for (let i = 0; i < QUESTIONS.length; i++) {
      const next = pickRandomVoicePreset(current);
      list.push(next);
      current = next;
    }
    return list;
  });

  // 页面一加载，后台静默并行下载解码并缓存 6 道题目的全部音频，彻底解决读题滞后问题
  useEffect(() => {
    QUESTIONS.forEach((q, idx) => {
      const preset = presets[idx];
      const speechText = [
        `第 ${idx + 1} 题。${q.text}。`,
        `抬起左臂选择左侧，${toSpeechLabel(q.options[0].label)}。`,
        `抬起右臂选择右侧，${toSpeechLabel(q.options[1].label)}。`,
        '手臂保持一小段时间即可确认。',
      ].join(' ');
      void prefetchTTS(speechText, preset);
    });
  }, [presets]);

  useEffect(() => {
    recordActivity();
  }, [currentIdx, recordActivity]);

  useEffect(() => {
    const activeKey = QUESTIONS[currentIdx]?.dimensionKey || null;
    useAppStore.getState().setActiveDimensionKey(activeKey);
    return () => {
      useAppStore.getState().setActiveDimensionKey(null);
    };
  }, [currentIdx]);

  useEffect(() => {
    // 答题阶段开始时，随机加载一个面具模型，保留与现有主流程兼容
    useAppStore.getState().randomizeMaskFile();
  }, []);

  const readQuestion = useCallback(() => {
    recordActivity();
    const presetToUse = presets[currentIdx];
    setVoicePreset(presetToUse);

    const speechText = [
      `第 ${currentIdx + 1} 题。${question.text}。`,
      `抬起左臂选择左侧，${toSpeechLabel(question.options[0].label)}。`,
      `抬起右臂选择右侧，${toSpeechLabel(question.options[1].label)}。`,
      '手臂保持一小段时间即可确认。',
    ].join(' ');

    speakWithPreset(
      speechText,
      presetToUse,
      () => setMirrorSpeaking(true),
      () => setMirrorSpeaking(false),
    );
  }, [currentIdx, question, recordActivity, setVoicePreset, setMirrorSpeaking, presets]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      readQuestion();
    }, QUESTION_READING_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      stopSpeaking();
      setMirrorSpeaking(false);
    };
  }, [currentIdx, readQuestion, setMirrorSpeaking]);

  const handleAnswer = useCallback((value: 0 | 1) => {
    recordActivity();
    stopSpeaking();
    setMirrorSpeaking(false);

    const newAnswers = [...answers];
    newAnswers[currentIdx] = value;
    setAnswers(newAnswers);

    if (currentIdx < QUESTIONS.length - 1) {
      setTimeout(() => {
        setCurrentIdx(currentIdx + 1);
        useAppStore.getState().randomizeMaskFile();
      }, 300);
    } else {
      recordAndGenerate(newAnswers);
    }
  }, [currentIdx, answers, recordActivity, setMirrorSpeaking]);
   const recordAndGenerate = (finalAnswers: (0 | 1)[]) => {
     const dims: PersonalityDimensions = {
       capital: finalAnswers[0] as 0 | 1,
       spirit: finalAnswers[1] as 0 | 1,
       intellect: finalAnswers[2] as 0 | 1,
       social: finalAnswers[3] as 0 | 1,
       order: finalAnswers[4] as 0 | 1,
       energy: finalAnswers[5] as 0 | 1,
     };
    useAppStore.setState({ personalityDimensions: dims });
    setTimeout(() => triggerGeneration(), 300);
  };

  const handlePrevious = () => {
    recordActivity();
    stopSpeaking();
    setMirrorSpeaking(false);
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      useAppStore.getState().randomizeMaskFile();
    }
  };

  const handleCancel = () => {
    recordActivity();
    stopSpeaking();
    setMirrorSpeaking(false);
    removeLastQAAnswer();
    setStage('STANDBY');
    setCurrentIdx(0);
    setAnswers(Array(6).fill(-1));
  };

  const { gestureIndex, holdProgress, isPoseArmed, selectionPhase } = usePoseSelect((optionIdx) => {
    handleAnswer(optionIdx as 0 | 1);
  }, { resetKey: currentIdx });

  const interactionStatus = selectionPhase === 'selecting'
    ? '举臂确认中'
    : isPoseArmed
      ? '已就绪，可举臂作答'
      : '中立复位中';

  return (
    <div className="stage stage-questioning">
      <QuestionArmOverlay
        poseLandmarks={poseLandmarks}
        activeSide={gestureIndex}
        isPoseArmed={isPoseArmed}
      />

      {/* 选项显示在顶部左右两侧 */}
      <div className="question-top-options">
        {question.options.map((opt, idx) => {
          const isGestureHover = gestureIndex === idx;
          const progress = isGestureHover ? holdProgress : 0;
          return (
            <button
              key={`${question.id}-${opt.value}`}
              type="button"
              ref={(element) => {
                optionButtonRefs.current[idx] = element;
              }}
              className={`btn-option btn-option--top-${idx === 0 ? 'left' : 'right'}${isGestureHover ? ' btn-option--gesture' : ''}`}
              style={isGestureHover ? {
                '--gesture-progress': `${progress * 360}deg`,
              } as CSSProperties : undefined}
            >
              <span className="btn-option-index">{idx === 0 ? '← 举起左臂选择' : '举起右臂选择 →'}</span>
              <span className="btn-option-label">{opt.label}</span>
              {isGestureHover && (
                <span className="gesture-hint">
                  保持 1.2 秒
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 题目和控制按钮在最底部 */}
      <div className="question-content question-content--bottom">
        <div className="question-head">
          <div className="question-head-left">
            <div className="question-step">第 {currentIdx + 1} 题 / 共 {QUESTIONS.length} 题</div>
            <div className="question-progress">
              当前音色：{activeVoicePresetName} | {interactionStatus}
            </div>
          </div>
          <button
            type="button"
            className={`btn-question-audio${isMirrorSpeaking ? ' btn-question-audio--active' : ''}`}
            onClick={() => readQuestion()}
          >
            {isMirrorSpeaking ? '朗读中...' : '重读题目'}
          </button>
        </div>

        <h2 className="question-text">{question.text}</h2>

        <div className="qa-controls">
          <button
            className="btn-qa-control"
            type="button"
            onClick={handlePrevious}
            disabled={currentIdx === 0}
          >
            ← 上一题
          </button>
          <button className="btn-qa-control" type="button" onClick={handleCancel}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
