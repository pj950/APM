import { useAppStore } from '../../store/useAppStore';
import { useEffect } from 'react';
import { useMemo } from 'react';



export function ResultStage() {
  const llmResultText = useAppStore((s) => s.llmResultText);
  const archetype = useAppStore((s) => s.calculatedArchetype);
  const resetSession = useAppStore((s) => s.resetSession);
  const setStage = useAppStore((s) => s.setStage);
  const clearDialogue = useAppStore((s) => s.clearDialogue);
  const qaAnswers = useAppStore((s) => s.qaAnswers);



  const personalityProfileText = useMemo(() => {
    if (!archetype) return '';

    const d = archetype.dimensions;
    const dimLabels = [
      `资本:${d.capital === 1 ? '财阀' : '贫穷者'}`,
      `精神:${d.spirit === 1 ? '放纵者' : '僧人'}`,
      `认知:${d.intellect === 1 ? '学者' : '傻乐者'}`,
      `社交:${d.social === 1 ? '社交花' : '隐士'}`,
      `秩序:${d.order === 1 ? '完美者' : '浑浊者'}`,
      `能量:${d.energy === 1 ? '狂躁者' : '瘫倒者'}`,
    ];

    const decisionStyle = d.intellect === 1
      ? (d.order === 1 ? '你做决策偏理性且结构化，习惯先建模再行动。' : '你做决策偏理性，但更依赖直觉跳跃和非常规联想。')
      : (d.order === 1 ? '你做决策更依赖经验与直观，但会在执行上保持稳定节奏。' : '你做决策偏感受驱动，容易在灵感与冲动之间快速切换。');

    const socialStyle = d.social === 1
      ? '在人际中你主动连接、善于破冰，但也需要边界感来避免被他人情绪牵引。'
      : '在人际中你更重深度而非广度，信任建立慢，但一旦认同会非常稳定。';

    const stressStyle = d.energy === 1
      ? '压力升高时你会进入高速模式，建议用“短冲刺 + 强制停顿”避免过载。'
      : '压力升高时你会下沉蓄力，建议设置明确起步动作，避免长期停滞。';

    const spiritStyle = d.spirit === 1
      ? '欲望与好奇心是你的推进器，关键在于把冲动转化为可持续的目标。'
      : '克制与观察力是你的优势，关键在于避免过度迟疑而错过时机。';

    const qaKeywords = qaAnswers
      .map((qa) => qa.selectedLabel)
      .filter((label): label is string => Boolean(label))
      .slice(0, 4)
      .join(' / ');

    const lines = [
      `你属于「${archetype.name}」人格，核心原型为 ${archetype.baseType}。`,
      `基础气质：${archetype.description}。`,
      decisionStyle,
      socialStyle,
      stressStyle,
      spiritStyle,
      `六维坐标：${dimLabels.join(' · ')}`,
      qaKeywords ? `答题倾向：${qaKeywords}` : '',
    ].filter(Boolean);

    return lines.join('\n\n');
  }, [archetype, qaAnswers]);

  const resultNarrative = useMemo(() => {
    const base = (llmResultText || '').trim();
    const profile = personalityProfileText.trim();
    if (!profile) return base;
    if (!base) return `—— 性格侧写 ——\n${profile}`;
    if (base.includes('—— 性格侧写 ——')) return base;
    return `${base}\n\n—— 性格侧写 ——\n${profile}`;
  }, [llmResultText, personalityProfileText]);

  useEffect(() => {
    // 1. 播放科技感扫描完成音频 (Web Audio 级联合成器)
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        const now = audioCtx.currentTime;

        // 主音扫频振荡器
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.9);

        // 调制器（增加计算机数字咬合金属音感）
        const mod = audioCtx.createOscillator();
        mod.type = 'triangle';
        mod.frequency.setValueAtTime(320, now);
        mod.frequency.exponentialRampToValueAtTime(960, now + 0.6);

        const modGain = audioCtx.createGain();
        modGain.gain.setValueAtTime(0.08, now);
        modGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.2, now + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

        // 延迟回授
        const delayNode = audioCtx.createDelay();
        delayNode.delayTime.value = 0.16;
        const feedbackNode = audioCtx.createGain();
        feedbackNode.gain.value = 0.36;

        osc.connect(gainNode);
        mod.connect(modGain);
        modGain.connect(gainNode.gain);

        gainNode.connect(audioCtx.destination);

        gainNode.connect(delayNode);
        delayNode.connect(feedbackNode);
        feedbackNode.connect(delayNode);
        delayNode.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 1.3);
        mod.start(now);
        mod.stop(now + 0.75);
      }
    } catch (e) {
      console.warn('[VFX] Chime audio failed:', e);
    }

    // 1.5 播放经典擎天柱声音 (如果性格是 Singularity 机械体)
    let optimusTimeout: number | undefined;
    if (archetype?.baseType === 'Singularity') {
      const robotAudio = new Audio('/audio/optimus_clear_optimus_prime.wav');
      robotAudio.volume = 0.55;
      optimusTimeout = window.setTimeout(() => {
        robotAudio.play().catch((err) => console.warn('[Optimus] Audio play failed:', err));
      }, 350);
    }

    return () => {
      if (optimusTimeout) {
        clearTimeout(optimusTimeout);
      }
    };
  }, [archetype]);

  // 生成分享文本
  const generateShareText = () => {
    const dimText = archetype ? `[${archetype.dimensions.capital}${archetype.dimensions.spirit}${archetype.dimensions.intellect}${archetype.dimensions.social}${archetype.dimensions.order}${archetype.dimensions.energy}]` : '未知';
    const lines = [
      `🪞 AI 相镜扫描结果`,
      ``,
      `人格：${archetype?.name} ${dimText}`,
      ``,
      `判词：${resultNarrative}`,
    ];
    return lines.join('\n');
  };

  // 导出为文本
  const handleExport = () => {
    const text = generateShareText();
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', `AI-Mirror-${Date.now()}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // 复制到剪贴板
  const handleShare = () => {
    const text = generateShareText();
    navigator.clipboard.writeText(text).then(() => {
      alert('已复制到剪贴板！');
    }).catch(() => {
      alert('复制失败，请手动复制');
    });
  };

  return (
    <div className="stage stage-result">


      <div className="result-content">
        {/* 左侧：全息图像卡片 */}
        {archetype && (
          <div className="result-left-panel">
            <div className="hologram-card-wrap">
              <div className="hologram-card" style={{ '--theme-color': archetype.color } as React.CSSProperties}>
                <div className="hologram-grid" />
                <div className="hologram-scanline" />
                <div className="hologram-image-container">
                  <img
                    src={`/images/${archetype.id}_profile.png`}
                    alt={archetype.name}
                    className="hologram-image"
                    onError={(e) => {
                      const target = e.currentTarget;
                      const fallback = `/images/${archetype.baseType.toLowerCase()}_profile.png`;
                      if (target.src !== fallback) {
                        target.src = fallback;
                      }
                    }}
                  />
                </div>
                <div className="hologram-footer">
                  <div className="hologram-title">{archetype.name}</div>
                  <div className="hologram-subtitle">DIMENSION: {archetype.id}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 右侧：性格分析与交互操作 */}
        <div className="result-right-panel">
          <div className="archetype-badge" style={{ backgroundColor: archetype?.color || '#666' }}>
            <span className="archetype-name">{archetype?.name}</span>
            <span className="archetype-id">{archetype?.id}</span>
          </div>
          <p className="result-text">{resultNarrative}</p>

          <div className="result-actions">
            <button className="btn-primary" onClick={() => { resetSession(); setStage('STANDBY'); }}>
              ↺ 重新扫描
            </button>
            <button
              className="btn-primary"
              onClick={() => { clearDialogue(); setStage('DIALOGUE'); }}
            >
              🪞 进入对话
            </button>
            <button className="btn-secondary" onClick={handleShare}>
              📋 分享
            </button>
            <button className="btn-secondary" onClick={handleExport}>
              💾 导出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
