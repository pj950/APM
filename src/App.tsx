import { StageRouter } from './components/StageRouter';
import { GenerativeScene } from './components/three/GenerativeScene';
import { FluidSimulationCanvas } from './components/fluid/FluidSimulationCanvas';
import { useAppStore } from './store/useAppStore';
import type { FluidColorPalette, PersonalityDimensions } from './types';

function getDimensionPalette(key: keyof PersonalityDimensions | null): FluidColorPalette {
  switch (key) {
    case 'capital':
      return 'Solar Flares';    // Gold/yellow for wealth
    case 'spirit':
      return 'Neon Wave';       // Magenta/pink for soul
    case 'intellect':
      return 'Emerald Abyss';   // Cyan/blue for logical academics
    case 'social':
      return 'Vibrant Rainbow'; // Multicolored for social butterfly
    case 'order':
      return 'Monochrome Ink';  // Ordered black/white grids
    case 'energy':
      return 'Emerald Abyss';   // Green for high energy generator
    default:
      return 'Neon Wave';
  }
}

function App() {
  const currentStage = useAppStore((s) => s.currentStage);
  const fluidModeActive = useAppStore((s) => s.fluidModeActive);
  const fluidConfig = useAppStore((s) => s.fluidConfig);
  const activeDimensionKey = useAppStore((s) => s.activeDimensionKey);

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

  const isQuestioning = currentStage === 'QUESTIONING';
  const showBackground = currentStage !== 'TAROT';

  // Determine active fluid configuration (override color palette for active dimension during questioning)
  const activePalette = isQuestioning
    ? getDimensionPalette(activeDimensionKey)
    : fluidConfig.colorPalette;

  const activeFluidConfig = {
    ...fluidConfig,
    colorPalette: activePalette,
  };

  // Keep QUESTIONING on a vivid, stable fluid preset inspired by WebGL-Fluid-Simulation.
  // Match PavelDoGreat/WebGL-Fluid-Simulation config values for vivid fluid effect
  const questioningFluidConfig = {
    ...activeFluidConfig,
    vorticity: 30,            // CURL: 30
    dyeDissipation: 1.0,      // DENSITY_DISSIPATION: 1 (lower = longer lasting dye trails)
    velocityDissipation: 0.2,  // VELOCITY_DISSIPATION: 0.2 (lower = fluid moves longer)
    pressureIterations: 20,    // PRESSURE_ITERATIONS: 20
    splatRadius: 0.25,         // SPLAT_RADIUS: 0.25
    splatForce: 6.0,           // SPLAT_FORCE: 6000 (scaled for our system)
    shadingActive: true,       // SHADING: true
    useCVInteraction: true,
  };

  // Fluid renders in QUESTIONING stage or when manually toggled in STANDBY stage
  const showFluidBackground = isQuestioning || (currentStage === 'STANDBY' && fluidModeActive);

  // Three.js GenerativeScene renders in non-QUESTIONING, non-RESULT stages (and not STANDBY with fluid mode)
  const showGenerativeScene = currentStage !== 'QUESTIONING' && currentStage !== 'RESULT' && (currentStage !== 'STANDBY' || !fluidModeActive) && currentStage !== 'GUMGUM_DEMO' && currentStage !== 'FACE_DEMO';

  return (
    <>
      {showBackground && (
        <>
          {showFluidBackground && (
            <FluidSimulationCanvas config={isQuestioning ? questioningFluidConfig : activeFluidConfig} />
          )}
          {showGenerativeScene && <GenerativeScene />}
        </>
      )}
      <StageRouter />
    </>
  );
}

export default App;
