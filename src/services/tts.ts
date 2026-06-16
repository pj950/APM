/**
 * TTS 服务 - 浏览器 SpeechSynthesis + Web Audio 氛围音效 + 高级 Web Audio DSP 角色音色合成器
 *
 * 五种声音预设，模拟影视角色音色：
 *   gollum   - 咕噜（指环王）：高音微速、沙哑畸变、洞穴回声
 *   robot    - 机械：50Hz 环形调制、金属短反馈梳状滤波
 *   ethereal - 星云：空间长反馈延迟、LFO 合唱调制、飘渺高音
 *   deep     - 深渊：极低沉低速、超重低音滤波器、深渊回声
 *   crystal  - 水晶：清脆中性、高频增益、微清澈延迟
 *
 * 支持高级人声 API 自动对接与级联降级：
 *   - 优先级：ElevenLabs ➜ OpenAI ➜ 阿里 CosyVoice ➜ 默认 Web Audio DSP 滤镜音色 ➜ 浏览器内置语音
 *   - 用户只需在 .env.local 中配置对应的 API Key 即可开启超逼真人声。
 */

import type { VoicePresetKey } from '../types';

export interface VoicePreset {
  name: string;
  description: string;
  pitch: number;           // SpeechSynthesis pitch 0.1–2
  rate: number;            // SpeechSynthesis rate 0.1–3
  playbackRate: number;    // Web Audio playbackRate
  ambientType: AmbientType;
}

type AmbientType = 'cave' | 'electronic' | 'hall' | 'void' | 'none';

export const VOICE_PRESETS: Record<VoicePresetKey, VoicePreset> = {
  gollum: {
    name: '擎天柱 · 坚毅',
    description: '擎天柱领袖音色 - 深沉而坚毅的机械共鸣',
    pitch: 0.25,
    rate: 0.85,
    playbackRate: 0.8,
    ambientType: 'electronic',
  },
  robot: {
    name: '擎天柱 · 金属',
    description: '擎天柱金属音色 - 带有金属梳状混响的机械声',
    pitch: 0.25,
    rate: 0.85,
    playbackRate: 0.82,
    ambientType: 'electronic',
  },
  ethereal: {
    name: '擎天柱 · 宏大',
    description: '擎天柱空间音色 - 宏大空旷的钢铁殿堂回鸣',
    pitch: 0.3,
    rate: 0.88,
    playbackRate: 0.85,
    ambientType: 'hall',
  },
  deep: {
    name: '擎天柱 · 终极',
    description: '擎天柱深渊音色 - 极度低沉厚重的大黄蜂伴侣声线',
    pitch: 0.15,
    rate: 0.8,
    playbackRate: 0.72,
    ambientType: 'void',
  },
  crystal: {
    name: '擎天柱 · 经典',
    description: '擎天柱经典音色 - 均衡的塞伯坦机械人声',
    pitch: 0.3,
    rate: 0.9,
    playbackRate: 0.85,
    ambientType: 'none',
  },
};

// ── 环境变量配置 ──────────────────────────────────────────────────
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
const ALIYUN_API_KEY = import.meta.env.VITE_LLM_API_KEY || '';
const ALIYUN_API_URL = import.meta.env.VITE_LLM_API_URL || '';

// ── Web Audio 氛围音 ──────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let ambientNodes: AudioNode[] = [];
let ttsAudioLevel = 0;
let ttsAudioAnalyser: AnalyserNode | null = null;
let ttsAudioData: Uint8Array | null = null;
let ttsAudioFrame = 0;
let speechFallbackMeterFrame = 0;
let speechFallbackMeterPreset: VoicePresetKey | null = null;
let speechFallbackMeterStartedAt = 0;

const ttsAudioLevelListeners = new Set<() => void>();

const FALLBACK_METER_CONFIG: Record<VoicePresetKey, { speed: number; intensity: number; wobble: number }> = {
  gollum: { speed: 1.1, intensity: 0.72, wobble: 0.4 },
  robot: { speed: 1.15, intensity: 0.75, wobble: 0.35 },
  ethereal: { speed: 1.0, intensity: 0.8, wobble: 0.45 },
  deep: { speed: 0.8, intensity: 0.9, wobble: 0.5 },
  crystal: { speed: 1.2, intensity: 0.7, wobble: 0.3 },
};

function publishTTSAudioLevel(nextValue: number) {
  const clamped = Math.max(0, Math.min(1, nextValue));
  const shouldNotify = Math.abs(clamped - ttsAudioLevel) >= 0.015 || (clamped === 0 && ttsAudioLevel !== 0);
  ttsAudioLevel = clamped;

  if (shouldNotify) {
    ttsAudioLevelListeners.forEach((listener) => listener());
  }
}

export function getTTSAudioLevelSnapshot(): number {
  return ttsAudioLevel;
}

export function subscribeTTSAudioLevel(listener: () => void): () => void {
  ttsAudioLevelListeners.add(listener);
  return () => {
    ttsAudioLevelListeners.delete(listener);
  };
}

function stopTTSAudioMeter() {
  if (ttsAudioFrame) {
    window.cancelAnimationFrame(ttsAudioFrame);
    ttsAudioFrame = 0;
  }

  if (speechFallbackMeterFrame) {
    window.cancelAnimationFrame(speechFallbackMeterFrame);
    speechFallbackMeterFrame = 0;
  }

  if (ttsAudioAnalyser) {
    ttsAudioAnalyser.disconnect();
    ttsAudioAnalyser = null;
  }

  ttsAudioData = null;
  speechFallbackMeterPreset = null;
  publishTTSAudioLevel(0);
}

function sampleTTSAudioMeter() {
  if (!ttsAudioAnalyser || !ttsAudioData) {
    return;
  }

  ttsAudioAnalyser.getByteTimeDomainData(ttsAudioData);

  let sumSquares = 0;
  for (let index = 0; index < ttsAudioData.length; index++) {
    const centered = (ttsAudioData[index] - 128) / 128;
    sumSquares += centered * centered;
  }

  const rms = Math.sqrt(sumSquares / ttsAudioData.length);
  const boosted = Math.min(1, rms * 5.4);
  publishTTSAudioLevel(ttsAudioLevel * 0.7 + boosted * 0.3);
  ttsAudioFrame = window.requestAnimationFrame(sampleTTSAudioMeter);
}

function attachTTSAudioMeter(ctx: AudioContext, inputNode: AudioNode) {
  stopTTSAudioMeter();

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.84;

  inputNode.connect(analyser);
  analyser.connect(ctx.destination);

  ttsAudioAnalyser = analyser;
  ttsAudioData = new Uint8Array(analyser.fftSize);
  sampleTTSAudioMeter();
}

function startSpeechSynthesisMeter(presetKey: VoicePresetKey) {
  stopTTSAudioMeter();
  speechFallbackMeterPreset = presetKey;
  speechFallbackMeterStartedAt = performance.now();

  const tick = () => {
    if (!speechFallbackMeterPreset) {
      return;
    }

    const config = FALLBACK_METER_CONFIG[speechFallbackMeterPreset];
    const elapsed = (performance.now() - speechFallbackMeterStartedAt) / 1000;
    const envelope = 0.18 + Math.max(0, Math.sin(elapsed * Math.PI * config.speed * 1.8)) * (0.24 + config.intensity * 0.2);
    const chatter = Math.max(0, Math.sin(elapsed * (10 + config.speed * 2.2)) * 0.28)
      + Math.max(0, Math.sin(elapsed * (17 + config.wobble * 9)) * 0.18);
    const wobble = Math.sin(elapsed * (3.2 + config.wobble)) * 0.04;

    publishTTSAudioLevel(Math.min(1, envelope + chatter + wobble + config.intensity * 0.08));
    speechFallbackMeterFrame = window.requestAnimationFrame(tick);
  };

  speechFallbackMeterFrame = window.requestAnimationFrame(tick);
}

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

const ttsCache = new Map<string, AudioBuffer>();
const inFlightPrefetches = new Set<string>();

/**
 * 后台异步预加载并解码缓存 TTS 语音，用于消除答题时的网络音频加载滞后
 */
export async function prefetchTTS(text: string, presetKey: VoicePresetKey): Promise<void> {
  try {
    const chunks = splitTextIntoSentences(text);
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const promises = chunks.map(async (chunk) => {
      const cleanText = chunk.trim();
      if (!cleanText) return;
      const cacheKey = `${presetKey}:${cleanText}`;
      if (ttsCache.has(cacheKey) || inFlightPrefetches.has(cacheKey)) return;

      inFlightPrefetches.add(cacheKey);
      try {
        const buffer = await fetchTTSAudioBuffer(ctx, cleanText, presetKey);
        ttsCache.set(cacheKey, buffer);
        console.log(`[TTS Cache] Prefetched and cached sentence: "${cleanText.slice(0, 12)}..."`);
      } catch (err) {
        console.warn(`[TTS Cache] Prefetch failed for chunk: "${cleanText.slice(0, 12)}..."`, err);
      } finally {
        inFlightPrefetches.delete(cacheKey);
      }
    });

    await Promise.all(promises);
  } catch (err) {
    console.warn(`[TTS Cache] Prefetch process error:`, err);
  }
}

function stopAmbient() {
  ambientNodes.forEach((n) => {
    try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ }
    n.disconnect();
  });
  ambientNodes = [];
}

/**
 * 根据 ambientType 创建持续氛围音（在 speaking 期间播放）
 */
function startAmbient(type: AmbientType, duration: number): void {
  if (type === 'none') return;
  try {
    const ctx = getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.3);
    masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration - 0.2);
    masterGain.connect(ctx.destination);

    if (type === 'cave') {
      const rumble = ctx.createOscillator();
      rumble.type = 'sawtooth';
      rumble.frequency.setValueAtTime(55, ctx.currentTime);
      rumble.frequency.linearRampToValueAtTime(48, ctx.currentTime + duration);
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.5;
      rumble.connect(rumbleGain);
      rumbleGain.connect(masterGain);
      rumble.start();
      rumble.stop(ctx.currentTime + duration);
      ambientNodes.push(rumble, rumbleGain);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 8;
      lfo.connect(lfoGain);
      lfoGain.connect(rumble.frequency);
      lfo.start();
      lfo.stop(ctx.currentTime + duration);
      ambientNodes.push(lfo, lfoGain);

    } else if (type === 'electronic') {
      const carrier = ctx.createOscillator();
      carrier.type = 'square';
      carrier.frequency.value = 180;
      const modulator = ctx.createOscillator();
      modulator.type = 'sine';
      modulator.frequency.value = 40;
      const modGain = ctx.createGain();
      modGain.gain.value = 60;
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(masterGain);
      carrier.start(); carrier.stop(ctx.currentTime + duration);
      modulator.start(); modulator.stop(ctx.currentTime + duration);
      ambientNodes.push(carrier, modulator, modGain);

    } else if (type === 'hall') {
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 880 * (i + 1) * 0.5;
        const g = ctx.createGain();
        g.gain.value = 0.12 / (i + 1);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(); osc.stop(ctx.currentTime + duration);
        ambientNodes.push(osc, g);
      }

    } else if (type === 'void') {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 28;
      sub.connect(masterGain);
      sub.start(); sub.stop(ctx.currentTime + duration);
      ambientNodes.push(sub);
    }

    ambientNodes.push(masterGain);
  } catch {
    // Web Audio 不可用时静默
  }
}

// ── Web Audio 角色音色效果器实现 ─────────────────────────────────────────

interface QueueItem {
  text: string;
}

let speechQueue: QueueItem[] = [];
let queueIndex = 0;
let isPlayingQueue = false;
let activeOnEnd: (() => void) | null = null;

let currentSourceNode: AudioBufferSourceNode | null = null;
let currentOscNodes: OscillatorNode[] = [];
let currentEffectsNodes: AudioNode[] = [];
let currentSpeechTimeout: number | null = null;

/** 文本切分器，按标点和换行将文本分割为合适的长句 */
export function splitTextIntoSentences(text: string): string[] {
  const rawChunks = text.split(/([。！？；.!?;\n\r：:])/g);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const chunk of rawChunks) {
    if (!chunk) continue;
    if (chunk.match(/[。！？；.!?;\n\r：:]/)) {
      currentChunk += chunk;
      const trimmed = currentChunk.trim();
      if (trimmed) chunks.push(trimmed);
      currentChunk = '';
    } else {
      currentChunk += chunk;
    }
  }

  const remaining = currentChunk.trim();
  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter((c) => c.length > 0);
}

// ── 真实人声 API 抓取函数 ──────────────────────────────────────────

/** ElevenLabs TTS REST API */
async function fetchElevenLabsTTS(ctx: AudioContext, text: string, voiceId: string, apiKey: string): Promise<AudioBuffer> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v1', // 支持中文
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS HTTP status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/** OpenAI TTS REST API */
async function fetchOpenAITTS(ctx: AudioContext, text: string, voice: string, apiKey: string): Promise<AudioBuffer> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: voice,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI TTS HTTP status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/** 阿里 DashScope CosyVoice TTS REST API */
async function fetchDashScopeTTS(ctx: AudioContext, text: string, voice: string, apiKey: string): Promise<AudioBuffer> {
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/text-to-speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'cosyvoice-v1',
      input: {
        text: text,
      },
      parameters: {
        voice: voice,
        volume: 50,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Aliyun CosyVoice TTS HTTP status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/** 统一获取音频数据入口：进行级联判断与请求 */
async function fetchTTSAudioBuffer(ctx: AudioContext, text: string, presetKey: VoicePresetKey): Promise<AudioBuffer> {
  // 1. ElevenLabs TTS (如果配置了 Key)
  if (ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'your-api-key-here') {
    // 默认内置的 ElevenLabs Voice ID，如果用户在 env 里配置了对应角色的 Voice ID 则优先读取
    const voiceIds = {
      gollum: import.meta.env.VITE_ELEVENLABS_VOICE_ID_DEEP || 'VR6A4lskZJyxko4sazRj', // Arnold
      robot: import.meta.env.VITE_ELEVENLABS_VOICE_ID_DEEP || 'VR6A4lskZJyxko4sazRj',
      ethereal: import.meta.env.VITE_ELEVENLABS_VOICE_ID_DEEP || 'VR6A4lskZJyxko4sazRj',
      deep: import.meta.env.VITE_ELEVENLABS_VOICE_ID_DEEP || 'VR6A4lskZJyxko4sazRj',
      crystal: import.meta.env.VITE_ELEVENLABS_VOICE_ID_DEEP || 'VR6A4lskZJyxko4sazRj',
    };
    const voiceId = voiceIds[presetKey];
    try {
      console.log(`[TTS] Requesting ElevenLabs voice for preset "${presetKey}"...`);
      return await fetchElevenLabsTTS(ctx, text, voiceId, ELEVENLABS_API_KEY);
    } catch (e) {
      console.warn(`ElevenLabs TTS failed:`, e);
    }
  }

  // 2. OpenAI TTS (如果配置了 Key)
  if (OPENAI_API_KEY && OPENAI_API_KEY !== 'your-api-key-here') {
    const voices = {
      gollum: 'onyx',
      robot: 'onyx',
      ethereal: 'echo',
      deep: 'onyx',
      crystal: 'echo',
    };
    const voice = voices[presetKey];
    try {
      console.log(`[TTS] Requesting OpenAI voice "${voice}" for preset "${presetKey}"...`);
      return await fetchOpenAITTS(ctx, text, voice, OPENAI_API_KEY);
    } catch (e) {
      console.warn(`OpenAI TTS failed:`, e);
    }
  }

  // 3. 阿里 DashScope CosyVoice TTS (如果配置了 LLM Key 且属于阿里大模型端)
  if (ALIYUN_API_KEY && ALIYUN_API_KEY !== 'your-api-key-here' && ALIYUN_API_URL.includes('dashscope.aliyuncs.com')) {
    const voices = {
      gollum: 'longlaotie', // 粗犷男声
      robot: 'longlaotie',
      ethereal: 'longxiaoyi', // 正式男声
      deep: 'longlaotie',
      crystal: 'longxiaoyi',
    };
    const voice = voices[presetKey];
    try {
      console.log(`[TTS] Requesting Aliyun CosyVoice "${voice}" for preset "${presetKey}"...`);
      return await fetchDashScopeTTS(ctx, text, voice, ALIYUN_API_KEY);
    } catch (e) {
      console.warn(`Aliyun CosyVoice TTS failed:`, e);
    }
  }

  // 4. 级联兜底：本地开发代理 ➜ 免费的 Google Translate TTS 接口 (通过公共代理)
  const cleanText = text.trim();
  try {
    const localUrl = `/api/google-tts?ie=UTF-8&tl=zh-CN&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    const response = await fetch(localUrl);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return await ctx.decodeAudioData(arrayBuffer);
    }
  } catch (localErr) {
    console.warn('[TTS] Local proxy failed, falling back to public CORS proxy:', localErr);
  }

  const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-CN&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(googleTtsUrl)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`Google TTS proxy response status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

// ── Web Audio DSP 音频图处理 ──────────────────────────────────────

/** 创建简易延时反馈效果器，用于模拟空间与回声 */
function createDelayEffect(
  ctx: AudioContext,
  delayTime: number,
  feedbackValue: number,
  wetValue: number,
) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay();
  const feedback = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();

  delay.delayTime.value = delayTime;
  feedback.gain.value = feedbackValue;
  wet.gain.value = wetValue;
  dry.gain.value = 1 - wetValue;

  input.connect(dry);
  dry.connect(output);

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay); // 反馈环路
  delay.connect(wet);
  wet.connect(output);

  return { input, output };
}

/** 停止当前的 Web Audio 音频节点播放 */
function stopCurrentPlayback() {
  stopTTSAudioMeter();

  if (currentSourceNode) {
    try { currentSourceNode.stop(); } catch { /* ignore */ }
    currentSourceNode.disconnect();
    currentSourceNode = null;
  }

  currentOscNodes.forEach((osc) => {
    try { osc.stop(); } catch { /* ignore */ }
    osc.disconnect();
  });
  currentOscNodes = [];

  currentEffectsNodes.forEach((node) => {
    node.disconnect();
  });
  currentEffectsNodes = [];

  if (currentSpeechTimeout) {
    window.clearTimeout(currentSpeechTimeout);
    currentSpeechTimeout = null;
  }
  stopAmbient();
}

/** 使用 Web Audio API 播放指定的 AudioBuffer 并进行实时 DSP 特效处理 */
function playAudioBufferWithPreset(
  ctx: AudioContext,
  buffer: AudioBuffer,
  presetKey: VoicePresetKey,
  onFinished: () => void,
) {
  stopCurrentPlayback();

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  currentSourceNode = source;

  const preset = VOICE_PRESETS[presetKey];
  source.playbackRate.value = preset.playbackRate;

  let lastNode: AudioNode = source;

  // 1. 播放低频背景氛围音
  startAmbient(preset.ambientType, buffer.duration / preset.playbackRate);

  // 2. 根据不同的音色键，构建不同的 DSP 音频图 (Audio Graph)
  // ── 构建通用 Optimus Prime DSP 处理模块 ──
  // 1. 低通/带通/高架 EQ 滤波器，用于调谐每个预设的声学特性，并提供暖和的低端饱满度
  let eqFilter: BiquadFilterNode | null = null;
  if (presetKey === 'gollum') {
    // 坚毅：低通滤波器，过滤尖锐高频
    eqFilter = ctx.createBiquadFilter();
    eqFilter.type = 'lowpass';
    eqFilter.frequency.value = 1200;
  } else if (presetKey === 'robot') {
    // 金属：稍微宽一些的低通，保留部分高频金属杂音
    eqFilter = ctx.createBiquadFilter();
    eqFilter.type = 'lowpass';
    eqFilter.frequency.value = 1500;
  } else if (presetKey === 'ethereal') {
    // 宏大：带通滤波器聚焦中低频
    eqFilter = ctx.createBiquadFilter();
    eqFilter.type = 'bandpass';
    eqFilter.frequency.value = 800;
    eqFilter.Q.value = 0.8;
  } else if (presetKey === 'deep') {
    // 终极：重度低通，只留下纯厚重低音
    eqFilter = ctx.createBiquadFilter();
    eqFilter.type = 'lowpass';
    eqFilter.frequency.value = 800;
  } else if (presetKey === 'crystal') {
    // 经典：高架滤波器提升金属高频清晰度
    eqFilter = ctx.createBiquadFilter();
    eqFilter.type = 'highshelf';
    eqFilter.frequency.value = 2500;
    eqFilter.gain.value = 3.5;
  }

  if (eqFilter) {
    lastNode.connect(eqFilter);
    lastNode = eqFilter;
    currentEffectsNodes.push(eqFilter);
  }

  // 2. Ring Modulation (金属机械环形调制器)：擎天柱的机械发声器关键
  const ringMod = ctx.createGain();
  ringMod.gain.value = 0.0;

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  // 不同预设的环形调制频率微调：坚毅(35Hz)、金属(45Hz)、宏大(38Hz)、终极(30Hz)、经典(40Hz)
  const carrierFrequencies: Record<VoicePresetKey, number> = {
    gollum: 35,
    robot: 45,
    ethereal: 38,
    deep: 30,
    crystal: 40,
  };
  carrier.frequency.value = carrierFrequencies[presetKey];
  carrier.start();
  currentOscNodes.push(carrier);

  // 调制深度：通过在最后混合干声和调制声，或者限制调制量来确保语音可懂度
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.value = 0.45; // 45% 干声
  wetGain.gain.value = 0.55; // 55% 机械调制声

  carrier.connect(ringMod.gain);
  lastNode.connect(ringMod); // 输入连接到调制器
  
  // 混合
  const mixNode = ctx.createGain();
  lastNode.connect(dryGain);
  ringMod.connect(wetGain);
  dryGain.connect(mixNode);
  wetGain.connect(mixNode);

  lastNode = mixNode;
  currentEffectsNodes.push(ringMod, dryGain, wetGain, mixNode);

  // 3. Comb Filter (紧凑金属梳状滤波器)：产生喉腔金属管道共鸣
  const combDelays: Record<VoicePresetKey, number> = {
    gollum: 0.014,
    robot: 0.010,
    ethereal: 0.016,
    deep: 0.018,
    crystal: 0.012,
  };
  const combFeedbacks: Record<VoicePresetKey, number> = {
    gollum: 0.45,
    robot: 0.55,
    ethereal: 0.40,
    deep: 0.50,
    crystal: 0.35,
  };
  const { input: combIn, output: combOut } = createDelayEffect(
    ctx,
    combDelays[presetKey],
    combFeedbacks[presetKey],
    0.45 // wet 比例
  );
  lastNode.connect(combIn);
  lastNode = combOut;
  currentEffectsNodes.push(combIn, combOut);

  // 4. Cinematic Reverb / Feedback Delay (宏大空间延迟器)：营造领袖登场的史诗感
  const reverbDelays: Record<VoicePresetKey, number> = {
    gollum: 0.22,
    robot: 0.18,
    ethereal: 0.32,
    deep: 0.28,
    crystal: 0.12,
  };
  const reverbFeedbacks: Record<VoicePresetKey, number> = {
    gollum: 0.35,
    robot: 0.30,
    ethereal: 0.52,
    deep: 0.45,
    crystal: 0.20,
  };
  const reverbWets: Record<VoicePresetKey, number> = {
    gollum: 0.30,
    robot: 0.28,
    ethereal: 0.42,
    deep: 0.38,
    crystal: 0.18,
  };
  const { input: delayIn, output: delayOut } = createDelayEffect(
    ctx,
    reverbDelays[presetKey],
    reverbFeedbacks[presetKey],
    reverbWets[presetKey]
  );
  lastNode.connect(delayIn);
  lastNode = delayOut;
  currentEffectsNodes.push(delayIn, delayOut);

  // 3. 输出到扬声器
  attachTTSAudioMeter(ctx, lastNode);

  source.onended = () => {
    onFinished();
  };

  source.start();
}

/** 最终降级方案：调用原生浏览器 SpeechSynthesis 进行播放 */
function playSpeechSynthesisFallback(text: string, presetKey: VoicePresetKey) {
  stopCurrentPlayback();

  const preset = VOICE_PRESETS[presetKey];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = preset.pitch;
  utterance.rate = preset.rate;
  utterance.lang = 'zh-CN';

  const voices = window.speechSynthesis.getVoices();
  const cnVoice = voices.find(
    (v) =>
      v.lang.includes('ZH') ||
      v.lang.includes('zh') ||
      v.name.includes('Chinese') ||
      v.name.includes('Huihui') ||
      v.name.includes('Yaoyao') ||
      v.name.includes('Kangkang')
  );
  if (cnVoice) {
    utterance.voice = cnVoice;
  }

  utterance.onstart = () => {
    const estimatedDuration = (text.length * 0.22) / preset.rate + 1;
    startAmbient(preset.ambientType, estimatedDuration);
    startSpeechSynthesisMeter(presetKey);
  };

  utterance.onend = () => {
    stopAmbient();
    stopTTSAudioMeter();
    if (activeOnEnd) {
      activeOnEnd();
      activeOnEnd = null;
    }
  };

  utterance.onerror = () => {
    stopAmbient();
    stopTTSAudioMeter();
    if (activeOnEnd) {
      activeOnEnd();
      activeOnEnd = null;
    }
  };

  window.speechSynthesis.speak(utterance);
}

/** 逐句轮询播放语音队列 */
async function processSpeechQueue(presetKey: VoicePresetKey) {
  if (!isPlayingQueue || queueIndex >= speechQueue.length) {
    isPlayingQueue = false;
    if (activeOnEnd) {
      activeOnEnd();
      activeOnEnd = null;
    }
    return;
  }

  const item = speechQueue[queueIndex];

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const cacheKey = `${presetKey}:${item.text}`;
    let buffer: AudioBuffer;
    if (ttsCache.has(cacheKey)) {
      buffer = ttsCache.get(cacheKey)!;
      console.log(`[TTS Cache] Hit cache for sentence: "${item.text.slice(0, 12)}..."`);
    } else {
      buffer = await fetchTTSAudioBuffer(ctx, item.text, presetKey);
      ttsCache.set(cacheKey, buffer); // 缓存起来以便重用
    }

    playAudioBufferWithPreset(ctx, buffer, presetKey, () => {
      queueIndex++;
      currentSpeechTimeout = window.setTimeout(() => {
        void processSpeechQueue(presetKey);
      }, 150);
    });

  } catch (error) {
    console.warn(`Web Audio character voice failed for sentence: "${item.text}". Falling back to browser SpeechSynthesis...`, error);
    const remainingText = speechQueue
      .slice(queueIndex)
      .map((i) => i.text)
      .join(' ');
    playSpeechSynthesisFallback(remainingText, presetKey);
  }
}

// ── 对外接口 ────────────────────────────────────────────────────────

/** 停止播放语音 */
export function stopSpeaking(): void {
  window.speechSynthesis.cancel();
  stopCurrentPlayback();

  speechQueue = [];
  queueIndex = 0;
  isPlayingQueue = false;

  if (activeOnEnd) {
    activeOnEnd();
    activeOnEnd = null;
  }
}

/** 用指定音色预设朗读文本（流式抓取 MP3 + Web Audio DSP） */
export function speakWithPreset(
  text: string,
  presetKey: VoicePresetKey,
  onStart?: () => void,
  onEnd?: () => void,
): void {
  stopSpeaking();

  activeOnEnd = onEnd || null;
  onStart?.();

  const chunks = splitTextIntoSentences(text);
  if (chunks.length === 0) {
    if (activeOnEnd) {
      activeOnEnd();
      activeOnEnd = null;
    }
    return;
  }

  speechQueue = chunks.map((t) => ({ text: t }));
  queueIndex = 0;
  isPlayingQueue = true;

  void processSpeechQueue(presetKey);
}
