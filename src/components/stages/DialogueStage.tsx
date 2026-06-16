/**
 * DialogueStage - 镜像对话界面
 *
 * 左侧：匿名动态面具 + 声音预设切换
 * 右侧：对话消息流 + 输入框
 */

import { useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { MirrorFace } from '../dialogue/MirrorFace';
import { VOICE_PRESETS, speakWithPreset, stopSpeaking, prefetchTTS, splitTextIntoSentences } from '../../services/tts';
import { streamDialogueReply } from '../../services/llm';
import type { DialogueTurn } from '../../services/llm';
import type { VoicePresetKey } from '../../types';

const VOICE_MASK_MAP: Record<VoicePresetKey, string> = {
  gollum: 'Flora',
  robot: 'Plasma',
  ethereal: 'Nebula',
  deep: 'Singularity',
  crystal: 'Crystal',
};

export function DialogueStage() {
  const archetype         = useAppStore((s) => s.calculatedArchetype);
  const dialogueMessages  = useAppStore((s) => s.dialogueMessages);
  const voicePreset       = useAppStore((s) => s.voicePreset);
  const isMirrorSpeaking  = useAppStore((s) => s.isMirrorSpeaking);
  const addMessage        = useAppStore((s) => s.addDialogueMessage);
  const setVoicePreset    = useAppStore((s) => s.setVoicePreset);
  const setMirrorSpeaking = useAppStore((s) => s.setMirrorSpeaking);
  const setStage          = useAppStore((s) => s.setStage);

  const baseType = VOICE_MASK_MAP[voicePreset] || 'Crystal';

  const [input, setInput]         = useState('');
  const [isTyping, setIsTyping]   = useState(false);  // mirror 正在"打字"
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;
    setInput('');

    // 用户消息入列
    addMessage({ role: 'user', content: text, timestamp: Date.now() });
    setIsTyping(true);
    setTimeout(scrollToBottom, 50);

    const history: DialogueTurn[] = [
      ...dialogueMessages.map((m) => ({
        role: m.role === 'mirror' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
      { role: 'user' as const, content: text },
    ];

    let replyText = '';
    let prefetchedIndex = 0;
    const replyTs = Date.now();

    addMessage({ role: 'mirror', content: '', timestamp: replyTs });

    await streamDialogueReply(
      archetype?.name || '镜像',
      history,
      (chunk) => {
        replyText += chunk;

        // 实时分割句子，对已完整生成的句子在后台进行并行预加载缓存
        const currentSentences = splitTextIntoSentences(replyText);
        for (let i = prefetchedIndex; i < currentSentences.length; i++) {
          const s = currentSentences[i];
          const isLast = i === currentSentences.length - 1;
          const isComplete = !isLast || /[。！？；.!?;\n\r：:]\s*$/.test(s);
          if (isComplete) {
            void prefetchTTS(s, voicePreset);
            prefetchedIndex = i + 1;
          }
        }

        // 直接更新最后一条 mirror 消息
        useAppStore.setState((state) => {
          const msgs = [...state.dialogueMessages];
          const lastIdx = msgs.length - 1;
          if (msgs[lastIdx]?.role === 'mirror') {
            msgs[lastIdx] = { ...msgs[lastIdx], content: replyText };
          }
          return { dialogueMessages: msgs };
        });
        setTimeout(scrollToBottom, 10);
      },
      () => {
        setIsTyping(false);
        // 语音朗读
        setMirrorSpeaking(true);
        speakWithPreset(
          replyText,
          voicePreset,
          undefined,
          () => setMirrorSpeaking(false),
        );
      },
    );
  }, [input, isTyping, dialogueMessages, baseType, voicePreset, addMessage, setMirrorSpeaking, archetype]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleBack = () => {
    stopSpeaking();
    setMirrorSpeaking(false);
    setStage('RESULT');
  };

  return (
    <div className="stage stage-dialogue">
      {/* 左侧面具区 */}
      <div className="dialogue-left">
        <div className="mirror-face-wrap">
          <MirrorFace baseType={baseType} isSpeaking={isMirrorSpeaking} />
          {isMirrorSpeaking && (
            <div className="speaking-indicator">
              <span /><span /><span />
            </div>
          )}
          {isTyping && !isMirrorSpeaking && (
            <div className="typing-indicator">思考中…</div>
          )}
        </div>

        {/* 声音预设选择器 */}
        <div className="voice-selector">
          <div className="voice-selector-label">音色</div>
          <div className="voice-presets">
            {(Object.entries(VOICE_PRESETS) as [VoicePresetKey, typeof VOICE_PRESETS[VoicePresetKey]][]).map(
              ([key, preset]) => (
                <button
                  key={key}
                  className={`btn-voice${voicePreset === key ? ' btn-voice--active' : ''}`}
                  onClick={() => setVoicePreset(key)}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              )
            )}
          </div>
        </div>

        <button className="btn-dialogue-back" onClick={handleBack}>
          ← 返回结果
        </button>
      </div>

      {/* 右侧对话区 */}
      <div className="dialogue-right">
        <div className="dialogue-header">
          <span className="dialogue-title">
            与 <em>{archetype?.name || '镜像'}</em> 镜像对话
          </span>
        </div>

        <div className="dialogue-messages">
          {dialogueMessages.length === 0 && (
            <div className="dialogue-empty">
              镜像已就绪。<br />向它提问，或说出你的困惑。
            </div>
          )}
          {dialogueMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`dialogue-bubble dialogue-bubble--${msg.role}`}
            >
              {msg.role === 'mirror' && (
                <span className="bubble-name">{archetype?.name || '镜像'}</span>
              )}
              <span className="bubble-text">
                {msg.content || (isTyping && idx === dialogueMessages.length - 1 ? '▌' : '')}
              </span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="dialogue-input-row">
          <textarea
            className="dialogue-input"
            placeholder="输入你想说的…"
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isTyping}
          />
          <button
            className="btn-dialogue-send"
            onClick={() => void sendMessage()}
            disabled={isTyping || !input.trim()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
