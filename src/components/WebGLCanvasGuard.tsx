import { Component, useEffect, type ReactNode } from 'react';
import * as THREE from 'three';

export const SAFE_WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: true,
  stencil: false,
  powerPreference: 'default',
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
};

const MINIMAL_WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {};

type SupportedWebGLContextName = 'webgl2' | 'webgl' | 'experimental-webgl';
type WebGLSupportProfile = 'balanced' | 'minimal' | 'legacy';

type WebGLContextCandidate = {
  contextName: SupportedWebGLContextName;
  profile: WebGLSupportProfile;
  attributes: WebGLContextAttributes;
};

const WEBGL_CONTEXT_CANDIDATES: WebGLContextCandidate[] = [
  {
    contextName: 'webgl2',
    profile: 'balanced',
    attributes: SAFE_WEBGL_CONTEXT_ATTRIBUTES,
  },
  {
    contextName: 'webgl',
    profile: 'balanced',
    attributes: SAFE_WEBGL_CONTEXT_ATTRIBUTES,
  },
  {
    contextName: 'webgl',
    profile: 'minimal',
    attributes: MINIMAL_WEBGL_CONTEXT_ATTRIBUTES,
  },
  {
    contextName: 'experimental-webgl',
    profile: 'legacy',
    attributes: MINIMAL_WEBGL_CONTEXT_ATTRIBUTES,
  },
];

type SupportedWebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

export type WebGLSupportDetails = {
  supported: boolean;
  contextName: SupportedWebGLContextName | null;
  profile: WebGLSupportProfile | null;
  reason: 'dom-unavailable' | 'api-missing' | 'context-creation-failed' | 'context-exception' | 'render-error' | null;
  message: string;
  error?: string;
};

let cachedWebGLSupportDetails: WebGLSupportDetails | null = null;

function createWebGLFailureDetails(
  reason: NonNullable<WebGLSupportDetails['reason']>,
  message: string,
  error?: string,
): WebGLSupportDetails {
  return {
    supported: false,
    contextName: null,
    profile: null,
    reason,
    message,
    error,
  };
}

function formatContextLabel(candidate: WebGLContextCandidate) {
  if (candidate.profile === 'balanced') {
    return candidate.contextName === 'webgl2' ? 'WebGL2 标准配置' : 'WebGL 标准配置';
  }

  if (candidate.profile === 'minimal') {
    return 'WebGL 最小兼容配置';
  }

  return 'experimental-webgl 兼容配置';
}

function canAttemptContext(candidate: WebGLContextCandidate) {
  if (candidate.contextName === 'webgl2') {
    return typeof window.WebGL2RenderingContext !== 'undefined';
  }

  return typeof HTMLCanvasElement !== 'undefined';
}

function tryCreateContext(canvas: HTMLCanvasElement, candidate: WebGLContextCandidate) {
  if (!canAttemptContext(candidate)) {
    return null;
  }

  return canvas.getContext(candidate.contextName, candidate.attributes) as SupportedWebGLContext | null;
}

function resolveWebGLContext(canvas: HTMLCanvasElement) {
  for (const candidate of WEBGL_CONTEXT_CANDIDATES) {
    const context = tryCreateContext(canvas, candidate);
    if (context) {
      return { candidate, context };
    }
  }

  return null;
}

function buildSuccessDetails(candidate: WebGLContextCandidate): WebGLSupportDetails {
  return {
    supported: true,
    contextName: candidate.contextName,
    profile: candidate.profile,
    reason: null,
    message: `${formatContextLabel(candidate)}创建成功。`,
  };
}

export function getWebGLSupportDetails(forceRecheck = false): WebGLSupportDetails {
  if (!forceRecheck && cachedWebGLSupportDetails) {
    return cachedWebGLSupportDetails;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    cachedWebGLSupportDetails = createWebGLFailureDetails(
      'dom-unavailable',
      '当前环境没有浏览器 DOM，无法初始化 WebGL。',
    );
    return cachedWebGLSupportDetails;
  }

  if (
    typeof window.WebGLRenderingContext === 'undefined'
    && typeof window.WebGL2RenderingContext === 'undefined'
  ) {
    cachedWebGLSupportDetails = createWebGLFailureDetails(
      'api-missing',
      '浏览器没有暴露 WebGL API。',
    );
    return cachedWebGLSupportDetails;
  }

  try {
    const canvas = document.createElement('canvas');
    const resolved = resolveWebGLContext(canvas);

    if (resolved) {
      cachedWebGLSupportDetails = buildSuccessDetails(resolved.candidate);
      return cachedWebGLSupportDetails;
    }

    cachedWebGLSupportDetails = createWebGLFailureDetails(
      'context-creation-failed',
      '浏览器存在 WebGL API，但即使回退到最小兼容配置与 experimental-webgl，当前 GPU 或驱动仍没有返回可用的 WebGL 上下文。',
    );
    return cachedWebGLSupportDetails;
  } catch (error) {
    cachedWebGLSupportDetails = createWebGLFailureDetails(
      'context-exception',
      '尝试创建 WebGL 上下文时抛出了异常。',
      error instanceof Error ? error.message : String(error),
    );
    return cachedWebGLSupportDetails;
  }
}

export function detectWebGLSupport(forceRecheck = false) {
  return getWebGLSupportDetails(forceRecheck).supported;
}

export function createBestEffortWebGLRenderer(canvas: HTMLCanvasElement) {
  const resolved = resolveWebGLContext(canvas);

  if (!resolved) {
    throw new Error('Unable to create a WebGL renderer from any compatible context profile.');
  }

  const { candidate, context } = resolved;

  return new THREE.WebGLRenderer({
    canvas,
    context,
    ...candidate.attributes,
  });
}

type WebGLCanvasGuardProps = {
  fallback: ReactNode;
  children: ReactNode;
  onFallback?: (details: WebGLSupportDetails) => void;
};

type WebGLCanvasGuardState = {
  hasError: boolean;
};

class WebGLCanvasErrorBoundary extends Component<WebGLCanvasGuardProps, WebGLCanvasGuardState> {
  state: WebGLCanvasGuardState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[WebGL] Canvas rendering failed, switching to compatibility mode.', error);
    this.props.onFallback?.(
      createWebGLFailureDetails(
        'render-error',
        'WebGL Canvas 初始化失败，已切换到兼容模式。',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export function WebGLCanvasGuard({ fallback, children, onFallback }: WebGLCanvasGuardProps) {
  const isSupported = detectWebGLSupport();

  useEffect(() => {
    if (!isSupported) {
      onFallback?.(getWebGLSupportDetails());
    }
  }, [isSupported, onFallback]);

  if (!isSupported) {
    return <>{fallback}</>;
  }

  return (
    <WebGLCanvasErrorBoundary fallback={fallback} onFallback={onFallback}>
      {children}
    </WebGLCanvasErrorBoundary>
  );
}