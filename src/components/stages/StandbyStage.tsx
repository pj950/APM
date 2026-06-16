import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { FluidColorPalette } from '../../types';

export function StandbyStage() {
  const fluidModeActive = useAppStore((s) => s.fluidModeActive);
  const setFluidModeActive = useAppStore((s) => s.setFluidModeActive);
  const fluidConfig = useAppStore((s) => s.fluidConfig);
  const updateFluidConfig = useAppStore((s) => s.updateFluidConfig);
  const setStage = useAppStore((s) => s.setStage);
  const recordScanStart = useAppStore((s) => s.recordScanStart);

  const [panelOpen, setPanelOpen] = useState(true);

  const handleStartScan = () => {
    recordScanStart();
    setStage('SCANNING');
  };

  const handleStartTarot = () => {
    recordScanStart();
    setStage('TAROT');
  };

  if (!fluidModeActive) {
    return (
      <div className="standby-toggle-container">
        <button
          className="btn-fluid-toggle"
          type="button"
          onClick={() => setFluidModeActive(true)}
        >
          <span className="icon">💧</span>
          <span className="label">流体镜面</span>
        </button>
      </div>
    );
  }

  // Map dyeDissipation (0.0 to 4.0) to user-friendly lifespan percentage (100% means 0.0, 0% means 4.0)
  const dissipationToPercent = (val: number) => {
    return Math.round((1.0 - val / 4.0) * 100);
  };
  const percentToDissipation = (pct: number) => {
    return (1.0 - pct / 100) * 4.0;
  };

  // Map splatRadius (0.01 to 1.0) to user-friendly size percentage (0% means 0.01, 100% means 1.0)
  const radiusToPercent = (val: number) => {
    return Math.round(((val - 0.01) / (1.0 - 0.01)) * 100);
  };
  const percentToRadius = (pct: number) => {
    return 0.01 + (pct / 100) * (1.0 - 0.01);
  };

  const palettes: FluidColorPalette[] = ["Neon Wave", "Solar Flares", "Emerald Abyss", "Monochrome Ink", "Vibrant Rainbow"];

  return (
    <div className="stage stage-standby stage-standby--fluid">
      {/* Settings Side Panel */}
      <div className={`fluid-settings-panel ${panelOpen ? 'fluid-settings-panel--open' : ''}`}>
        <button
          className="fluid-panel-toggle"
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          aria-label={panelOpen ? '关闭控制面板' : '打开控制面板'}
        >
          {panelOpen ? '→' : '← 流体控制'}
        </button>

        <div className="fluid-panel-content">
          <h3 className="panel-title">流体配置控制台</h3>

          <div className="setting-group">
            <label className="setting-label">颜色主题</label>
            <div className="palette-grid">
              {palettes.map((p) => (
                <button
                  key={p}
                  className={`btn-palette-select ${fluidConfig.colorPalette === p ? 'btn-palette-select--active' : ''}`}
                  type="button"
                  onClick={() => updateFluidConfig({ colorPalette: p })}
                >
                  {p === 'Neon Wave' && '霓虹波澜'}
                  {p === 'Solar Flares' && '烈焰太阳'}
                  {p === 'Emerald Abyss' && '翡翠幽谷'}
                  {p === 'Monochrome Ink' && '水墨黑白'}
                  {p === 'Vibrant Rainbow' && '七彩斑斓'}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-group">
            <div className="setting-header">
              <span className="setting-label">扰流强度</span>
              <span className="setting-value">{fluidConfig.vorticity}</span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={fluidConfig.vorticity}
              onChange={(e) => updateFluidConfig({ vorticity: Number(e.target.value) })}
              className="slider"
            />
          </div>

          <div className="setting-group">
            <div className="setting-header">
              <span className="setting-label">留存时长</span>
              <span className="setting-value">{dissipationToPercent(fluidConfig.dyeDissipation)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={dissipationToPercent(fluidConfig.dyeDissipation)}
              onChange={(e) => updateFluidConfig({ dyeDissipation: percentToDissipation(Number(e.target.value)) })}
              className="slider"
            />
          </div>

          <div className="setting-group">
            <div className="setting-header">
              <span className="setting-label">笔刷大小</span>
              <span className="setting-value">{radiusToPercent(fluidConfig.splatRadius)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={radiusToPercent(fluidConfig.splatRadius)}
              onChange={(e) => updateFluidConfig({ splatRadius: percentToRadius(Number(e.target.value)) })}
              className="slider"
            />
          </div>

          <div className="setting-group">
            <div className="setting-header">
              <span className="setting-label">喷洒力度</span>
              <span className="setting-value">{fluidConfig.splatForce.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.1"
              value={fluidConfig.splatForce}
              onChange={(e) => updateFluidConfig({ splatForce: Number(e.target.value) })}
              className="slider"
            />
          </div>

          <div className="setting-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={fluidConfig.shadingActive}
                onChange={(e) => updateFluidConfig({ shadingActive: e.target.checked })}
              />
              <span className="custom-checkbox"></span>
              伪3D玻璃高光阴影
            </label>
          </div>

          <div className="setting-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={fluidConfig.useCVInteraction}
                onChange={(e) => updateFluidConfig({ useCVInteraction: e.target.checked })}
              />
              <span className="custom-checkbox"></span>
              摄像头肢体动作互动
            </label>
          </div>
        </div>
      </div>

      {/* Standby Navigation Overlay */}
      <div className="fluid-standby-navigation">
        <h1 className="fluid-standby-title">数字人格解析装置</h1>
        <p className="fluid-standby-subtitle">挥动手臂或拖动鼠标，激起波澜。随时准备开始解析。</p>
        <div className="fluid-navigation-actions">
          <button
            className="btn-fluid-action btn-fluid-action--primary"
            type="button"
            onClick={handleStartScan}
          >
            开始人格解析
          </button>
          <button
            className="btn-fluid-action btn-fluid-action--secondary"
            type="button"
            onClick={handleStartTarot}
          >
            探索命运塔罗
          </button>
          <button
            className="btn-fluid-action btn-fluid-action--secondary"
            type="button"
            onClick={() => setStage('WATER_DEMO')}
            style={{ borderColor: 'rgba(0, 204, 255, 0.4)', color: '#90e3ff' }}
          >
            💧 手势交互水 3D 沙盒
          </button>
          <button
            className="btn-fluid-action btn-fluid-action--secondary"
            type="button"
            onClick={() => setStage('GUMGUM_DEMO')}
            style={{ borderColor: 'rgba(255, 107, 59, 0.4)', color: '#ff9d7b' }}
          >
            🤏 橡胶手指拉伸
          </button>
          <button
            className="btn-fluid-action btn-fluid-action--secondary"
            type="button"
            onClick={() => setStage('FACE_DEMO')}
            style={{ borderColor: 'rgba(0, 220, 255, 0.4)', color: '#7de8ff' }}
          >
            🎭 面部追踪演示
          </button>
          <button
            className="btn-fluid-action btn-fluid-action--tertiary"
            type="button"
            onClick={() => setFluidModeActive(false)}
          >
            返回宇宙星系
          </button>
        </div>
      </div>
    </div>
  );
}
