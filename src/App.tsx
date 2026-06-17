import { StageRouter } from './components/StageRouter';
import { GenerativeScene } from './components/three/GenerativeScene';
import { FluidSimulationCanvas } from './components/fluid/FluidSimulationCanvas';
import { useAppStore } from './store/useAppStore';

function App() {
  const currentStage = useAppStore((s) => s.currentStage);
  const fluidModeActive = useAppStore((s) => s.fluidModeActive);
  const fluidConfig = useAppStore((s) => s.fluidConfig);

  // If /tarot/index.html falls back to this SPA (assets missing), avoid recursive scene-in-iframe.
  if (window.location.pathname.startsWith('/tarot/')) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#05070d',
        color: '#d7e0ff',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        padding: '24px',
      }}>
        <div>
          <h2 style={{ marginBottom: '12px' }}>Tarot 资源未就绪</h2>
          <p>请先执行：<code>.\\scripts\\setup-tarot.ps1 -TarotDir "你的 ai-tarot-oracle 路径"</code></p>
          <p style={{ opacity: 0.7, marginTop: '8px' }}>然后刷新页面再试。</p>
        </div>
      </div>
    );
  }

  const showBackground = currentStage !== 'TAROT';

  // Fluid only renders when manually toggled in STANDBY; QUESTIONING uses the tracked face overlay instead.
  const showFluidBackground = currentStage === 'STANDBY' && fluidModeActive;

  // Three.js GenerativeScene renders in non-QUESTIONING, non-RESULT stages (and not STANDBY with fluid mode)
  const showGenerativeScene = currentStage !== 'QUESTIONING' && currentStage !== 'RESULT' && (currentStage !== 'STANDBY' || !fluidModeActive) && currentStage !== 'GUMGUM_DEMO' && currentStage !== 'FACE_DEMO';

  return (
    <>
      {showBackground && (
        <>
          {showFluidBackground && (
            <FluidSimulationCanvas config={fluidConfig} />
          )}
          {showGenerativeScene && <GenerativeScene />}
        </>
      )}
      <StageRouter />
    </>
  );
}

export default App;
