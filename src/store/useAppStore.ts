import { create } from 'zustand';
import type { AppState, CVFeatures, DialogueMessage, VoicePresetKey, FluidConfig } from '../types';
import { getPersonalityByDimensions } from '../configs/personalities';
import { getRandomMaskModelFile } from '../configs/maskModels';

const DEFAULT_CV: CVFeatures = {
  smileScore: 0,
  movementScore: 0,
  attentionScore: 0,
  opennessScore: 0,
};

const DEFAULT_FLUID_CONFIG: FluidConfig = {
  vorticity: 30,
  dyeDissipation: 1.0,
  velocityDissipation: 0.2,
  splatRadius: 0.25,
  pressureIterations: 20,
  colorPalette: 'Neon Wave',
  shadingActive: true,
  useCVInteraction: true,
  splatForce: 2.5,
};

function getRandomMaskFile(): string {
  return getRandomMaskModelFile() ?? 'mask.glb';
}

/**
 * 旧的 deriveArchetype 函数已停用
 * 现改用 getPersonalityByDimensions(dims) 基于 6 维度直接映射 64 种性格
 */
/*
function deriveArchetype(qa: QASelection[], cv: CVFeatures): VisualArchetype {
  // 统计各 trait 出现次数
  const traitCount: Record<string, number> = {};
  qa.forEach((a) => {
    traitCount[a.selectedTrait] = (traitCount[a.selectedTrait] || 0) + 1;
  });

  // 按次数排序，取前两个主导 trait 用于组合判断
  const sorted = Object.entries(traitCount).sort((a, b) => b[1] - a[1]);
  const topTraits = sorted.slice(0, 2).map(([trait]) => trait);
  const topCount = sorted[0]?.[1] ?? 0;
  const secondCount = sorted[1]?.[1] ?? 0;

  // 映射 baseType：支持更复杂的组合逻辑
  let baseType: VisualArchetype['baseType'] = 'Crystal';
  
  if (topTraits.includes('Flora')) {
    baseType = 'Flora';
  } else if (topTraits.includes('Chaos') && topCount >= secondCount + 1) {
    // Chaos 明显领先时才映射到 Plasma
    baseType = 'Plasma';
  } else if (topTraits.includes('Intuition')) {
    baseType = 'Nebula';
  } else if (topTraits.includes('Chaos') && topTraits.includes('Intuition')) {
    // Chaos + Intuition 组合 -> Singularity (打破秩序的直觉)
    baseType = 'Singularity';
  } else if (topTraits[0] === 'Order' || topTraits[0] === 'Logic') {
    baseType = 'Crystal';
  } else if (!topTraits[0]) {
    baseType = 'Singularity';
  }

  // 映射 modifierType (基于 CV 数据)
  let modifierType: VisualArchetype['modifierType'] = 'Static';
  
  if (cv.movementScore > 0.65 && cv.attentionScore > 0.55) {
    modifierType = 'Volatile';  // 活跃且专注
  } else if (cv.attentionScore > 0.75) {
    modifierType = 'Resonant';  // 极度专注
  } else if (cv.movementScore > 0.6) {
    modifierType = 'Volatile';  // 高活跃
  } else if (cv.movementScore < 0.3 && cv.attentionScore < 0.4) {
    modifierType = 'Drifting';  // 低活跃低专注
  }

  return { baseType, modifierType };
}
*/

export const useAppStore = create<AppState>((set, get) => ({
  currentStage: 'STANDBY',
  cvData: { ...DEFAULT_CV },
  faceLandmarks: null,
  poseLandmarks: null,
  handLandmarks: null,
  externalFaceVideo: null,
  trackingStatus: 'idle',
  trackingError: null,
  qaAnswers: [],
  calculatedArchetype: null,
  personalityDimensions: null,
  llmResultText: '',
  scanStartTime: null,
  finalCVData: null,
  dialogueMessages: [],
  voicePreset: 'gollum' as VoicePresetKey,
  isMirrorSpeaking: false,
  introZooming: false,
  introZoomProgress: 0,
  selectedMaskFile: getRandomMaskFile(),
  fluidModeActive: false,
  fluidConfig: { ...DEFAULT_FLUID_CONFIG },
  activeDimensionKey: null,

  setStage: (stage) => set({ currentStage: stage }),

  updateCVData: (data) =>
    set((state) => ({
      cvData: { ...state.cvData, ...data },
    })),

  updateFaceLandmarks: (landmarks) => set({ faceLandmarks: landmarks }),

  updatePoseLandmarks: (landmarks) => set({ poseLandmarks: landmarks }),

  updateHandLandmarks: (landmarks) => set({ handLandmarks: landmarks }),

  setExternalFaceVideo: (video) => set({ externalFaceVideo: video }),

  setTrackingStatus: (status) => set({ trackingStatus: status }),

  setTrackingError: (error) => set({ trackingError: error }),

  addQAAnswer: (answer) =>
    set((state) => ({
      qaAnswers: [...state.qaAnswers, answer],
    })),

  removeLastQAAnswer: () =>
    set((state) => ({
      qaAnswers: state.qaAnswers.slice(0, -1),
    })),

  recordScanStart: () => set({ scanStartTime: Date.now() }),

  recordFinalCVData: (data) => set({ finalCVData: data }),

  triggerGeneration: () => {
    const { personalityDimensions, cvData } = get();
    if (!personalityDimensions) return;

    // 从 6 维度转换为数组
    const dims: [0|1, 0|1, 0|1, 0|1, 0|1, 0|1] = [
      personalityDimensions.capital,
      personalityDimensions.spirit,
      personalityDimensions.intellect,
      personalityDimensions.social,
      personalityDimensions.order,
      personalityDimensions.energy,
    ];

    const baseArchetype = getPersonalityByDimensions(dims);
    
    // 根据最终 CV 状态计算修饰符类型 (modifierType)
    let modifierType: 'Static' | 'Volatile' | 'Resonant' | 'Drifting' = 'Static';
    if (cvData.movementScore > 0.65 && cvData.attentionScore > 0.55) {
      modifierType = 'Volatile';  // 活跃且专注
    } else if (cvData.attentionScore > 0.75) {
      modifierType = 'Resonant';  // 极度专注
    } else if (cvData.movementScore > 0.6) {
      modifierType = 'Volatile';  // 高活跃
    } else if (cvData.movementScore < 0.3 && cvData.attentionScore < 0.4) {
      modifierType = 'Drifting';  // 低活跃低专注
    }

    const archetype = {
      ...baseArchetype,
      modifierType,
    };

    set({
      calculatedArchetype: archetype,
      currentStage: 'GENERATING',
      finalCVData: cvData,  // 保存最终 CV 快照
    });
  },

  resetSession: () =>
    set({
      currentStage: 'STANDBY',
      cvData: { ...DEFAULT_CV },
      faceLandmarks: null,
      poseLandmarks: null,
      handLandmarks: null,
      trackingStatus: 'idle',
      trackingError: null,
      qaAnswers: [],
      calculatedArchetype: null,
      personalityDimensions: null,
      llmResultText: '',
      scanStartTime: null,
      finalCVData: null,
      dialogueMessages: [],
      isMirrorSpeaking: false,
      introZooming: false,
      introZoomProgress: 0,
      selectedMaskFile: getRandomMaskFile(),
      fluidModeActive: false,
      fluidConfig: { ...DEFAULT_FLUID_CONFIG },
      activeDimensionKey: null,
    }),

  randomizeMaskFile: () =>
    set({
      selectedMaskFile: getRandomMaskFile(),
    }),

  addDialogueMessage: (msg: DialogueMessage) =>
    set((state) => ({ dialogueMessages: [...state.dialogueMessages, msg] })),

  setVoicePreset: (preset: VoicePresetKey) => set({ voicePreset: preset }),

  setMirrorSpeaking: (speaking: boolean) => set({ isMirrorSpeaking: speaking }),

  clearDialogue: () => set({ dialogueMessages: [], isMirrorSpeaking: false }),

  setFluidModeActive: (active: boolean) => set({ fluidModeActive: active }),

  updateFluidConfig: (config) =>
    set((state) => ({
      fluidConfig: { ...state.fluidConfig, ...config },
    })),

  setActiveDimensionKey: (key) => set({ activeDimensionKey: key }),
}));
