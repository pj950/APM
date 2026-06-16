// ===== AI 相镜 - 核心数据结构定义 =====

export type FluidColorPalette = "Neon Wave" | "Solar Flares" | "Emerald Abyss" | "Monochrome Ink" | "Vibrant Rainbow";

export interface FluidConfig {
  vorticity: number;          // Curl strength (0 - 50)
  dyeDissipation: number;     // Dye fade rate (0.9 - 0.999)
  velocityDissipation: number;// Velocity decay rate (0.9 - 0.995)
  splatRadius: number;        // Splat size (0.0005 - 0.01)
  pressureIterations: number; // Jacobi solver iterations (5 - 40)
  colorPalette: FluidColorPalette;
  shadingActive: boolean;     // Enable pseudo-3D gloss/reflection
  useCVInteraction: boolean;  // Listen to poseLandmarks from MediaPipe
  splatForce: number;         // Splat velocity intensity (0.5 - 5.0)
}

/** 用户的实时特征数据 (经过平滑处理) */
export interface CVFeatures {
  smileScore: number;      // 0 - 1
  movementScore: number;   // 0 - 1
  attentionScore: number;  // 0 - 1
  opennessScore: number;   // 0 - 1 (肢体打开程度)
}

/** 用户的问答结果 */
export interface QASelection {
  questionId: string;
  selectedTrait: 'Order' | 'Chaos' | 'Intuition' | 'Logic' | 'Flora';
  questionText?: string;
  selectedLabel?: string;
}

/** 视觉原型 - 改为 6 维度 64 种性格 */
export interface PersonalityDimensions {
  // 每个维度 0 or 1
  capital: 0 | 1;      // 0=贫穷者, 1=财阀
  spirit: 0 | 1;       // 0=僧人, 1=放纵者
  intellect: 0 | 1;    // 0=傻乐者, 1=学者
  social: 0 | 1;       // 0=隐士, 1=社交花
  order: 0 | 1;        // 0=浑浊者, 1=完美者
  energy: 0 | 1;       // 0=瘫倒者, 1=狂躁者
}

export interface VisualArchetype {
  id: string;          // "000000"-"111111"
  name: string;        // 性格名称
  dimensions: PersonalityDimensions;
  color: string;       // HEX 颜色
  description: string; // 一句描述
  baseType: 'Crystal' | 'Nebula' | 'Plasma' | 'Flora' | 'Singularity';
  modifierType: 'Static' | 'Volatile' | 'Resonant' | 'Drifting';
}

/** 应用阶段枚举 */
export type AppStage = 'STANDBY' | 'SCANNING' | 'QUESTIONING' | 'GENERATING' | 'RESULT' | 'DIALOGUE' | 'TAROT' | 'WATER_DEMO' | 'GUMGUM_DEMO' | 'FACE_DEMO';

/** 镜像对话消息 */
export interface DialogueMessage {
  role: 'user' | 'mirror';
  content: string;
  timestamp: number;
}

/** 声音预设键名 */
export type VoicePresetKey = 'gollum' | 'robot' | 'ethereal' | 'deep' | 'crystal';

/** 全局 Zustand Store 结构 */
export interface AppState {
  currentStage: AppStage;
  cvData: CVFeatures;
  faceLandmarks: number[][] | null;
  poseLandmarks: number[][] | null;  // 原始 pose 骨骼点 (用于人形粒子渲染)
  handLandmarks: number[][] | null;  // 手部关键点 (用于手指计数手势)
  externalFaceVideo: HTMLVideoElement | null;  // 由 MindAR 接管摄像头时，供 CV 管线取帧做 pose 检测的视频源
  trackingStatus: 'idle' | 'loading' | 'ready' | 'error';
  trackingError: string | null;
  qaAnswers: QASelection[];
  calculatedArchetype: VisualArchetype | null;
  personalityDimensions: PersonalityDimensions | null;  // 64种性格维度
  llmResultText: string;
  scanStartTime: number | null;  // 进入 SCANNING 的时间戳
  finalCVData: CVFeatures | null;  // 生成前的最终 CV 数据快照
  selectedMaskFile: string | null; // 随机选取的 3D GLB 面具文件名

  // Actions
  setStage: (stage: AppStage) => void;
  updateCVData: (data: Partial<CVFeatures>) => void;
  updateFaceLandmarks: (landmarks: number[][] | null) => void;
  updatePoseLandmarks: (landmarks: number[][] | null) => void;
  updateHandLandmarks: (landmarks: number[][] | null) => void;
  setExternalFaceVideo: (video: HTMLVideoElement | null) => void;
  setTrackingStatus: (status: AppState['trackingStatus']) => void;
  setTrackingError: (error: string | null) => void;
  addQAAnswer: (answer: QASelection) => void;
  removeLastQAAnswer: () => void;
  recordScanStart: () => void;
  recordFinalCVData: (data: CVFeatures) => void;
  triggerGeneration: () => void;
  resetSession: () => void;
  randomizeMaskFile: () => void;

  // 镜像对话
  dialogueMessages: DialogueMessage[];
  voicePreset: VoicePresetKey;
  isMirrorSpeaking: boolean;
  addDialogueMessage: (msg: DialogueMessage) => void;
  setVoicePreset: (preset: VoicePresetKey) => void;
  setMirrorSpeaking: (speaking: boolean) => void;
  clearDialogue: () => void;
  // 3D 镜头转场
  introZooming: boolean;
  introZoomProgress: number;

  // 流体背景控制
  fluidModeActive: boolean;
  setFluidModeActive: (active: boolean) => void;
  fluidConfig: FluidConfig;
  updateFluidConfig: (config: Partial<FluidConfig>) => void;
  activeDimensionKey: keyof PersonalityDimensions | null;
  setActiveDimensionKey: (key: keyof PersonalityDimensions | null) => void;
}

/** WebWorker 消息类型 */
export interface CVWorkerMessage {
  type: 'init' | 'frame';
  payload?: ImageBitmap;
}

export interface CVWorkerResult {
  type: 'ready' | 'result' | 'error';
  payload?: {
    faceLandmarks?: number[][];
    poseLandmarks?: number[][];
  };
  error?: string;
}
