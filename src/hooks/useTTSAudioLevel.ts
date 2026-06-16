import { useSyncExternalStore } from 'react';
import { getTTSAudioLevelSnapshot, subscribeTTSAudioLevel } from '../services/tts';

export function useTTSAudioLevel() {
  return useSyncExternalStore(subscribeTTSAudioLevel, getTTSAudioLevelSnapshot, () => 0);
}