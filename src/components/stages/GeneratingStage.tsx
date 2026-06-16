import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { triggerLLMGeneration } from '../../services/llm';

export function GeneratingStage() {
  const llmResultText = useAppStore((s) => s.llmResultText);

  useEffect(() => {
    triggerLLMGeneration();
  }, []);

  return (
    <div className="stage stage-generating">
      <div className="generating-content">
        <h2 className="generating-title">解析中...</h2>
        <div className="generating-spinner" />
        {llmResultText && (
          <p className="generating-preview">{llmResultText}</p>
        )}
      </div>
    </div>
  );
}
