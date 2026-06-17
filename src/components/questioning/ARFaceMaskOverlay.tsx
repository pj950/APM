import { useEffect, useMemo, useRef, useState } from 'react';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { useAppStore } from '../../store/useAppStore';

type Point2D = {
  x: number;
  y: number;
};

type DrawPoint = Point2D & {
  z: number;
};

type VideoDisplayMetrics = {
  widthScale: number;
  heightScale: number;
  offsetX: number;
  offsetY: number;
};

const CAMERA_SOURCE_ASPECT = 4 / 3;
const QUESTION_FACE_TEXTURE = `${import.meta.env.BASE_URL}unity-face/textures/cartoon.png`;
const TEXTURE_ROTATION_SPEED = 0.18;
const FACE_TEXTURE_TRIANGLES = buildTextureTriangles();

function getVideoDisplayMetrics(viewportWidth: number, viewportHeight: number): VideoDisplayMetrics {
  const viewportAspect = viewportWidth / Math.max(viewportHeight, 1);

  if (viewportAspect > CAMERA_SOURCE_ASPECT) {
    const heightScale = viewportAspect / CAMERA_SOURCE_ASPECT;
    return {
      widthScale: 1,
      heightScale,
      offsetX: 0,
      offsetY: (1 - heightScale) * 0.5,
    };
  }

  const widthScale = CAMERA_SOURCE_ASPECT / Math.max(viewportAspect, 0.001);
  return {
    widthScale,
    heightScale: 1,
    offsetX: (1 - widthScale) * 0.5,
    offsetY: 0,
  };
}

function mapVideoPointToViewport(point: number[], metrics: VideoDisplayMetrics, width: number, height: number): DrawPoint {
  const coveredX = point[0] * metrics.widthScale + metrics.offsetX;
  const coveredY = point[1] * metrics.heightScale + metrics.offsetY;

  return {
    x: (1 - coveredX) * width,
    y: coveredY * height,
    z: point[2] ?? 0,
  };
}

function buildTextureTriangles() {
  const connections = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const neighbors = new Map<number, Set<number>>();
  const triangleSet = new Set<string>();
  const triangles: number[][] = [];

  for (const connection of connections) {
    if (!neighbors.has(connection.start)) neighbors.set(connection.start, new Set());
    if (!neighbors.has(connection.end)) neighbors.set(connection.end, new Set());
    neighbors.get(connection.start)!.add(connection.end);
    neighbors.get(connection.end)!.add(connection.start);
  }

  for (const connection of connections) {
    const a = connection.start;
    const b = connection.end;
    const aNeighbors = neighbors.get(a);
    const bNeighbors = neighbors.get(b);
    if (!aNeighbors || !bNeighbors) continue;

    for (const c of aNeighbors) {
      if (c === b || !bNeighbors.has(c)) continue;

      const key = [a, b, c].sort((left, right) => left - right).join('-');
      if (triangleSet.has(key)) continue;

      triangleSet.add(key);
      triangles.push([a, b, c]);
    }
  }

  return triangles;
}

function computeUvBounds(landmarks: number[][]) {
  const points = [10, 152, 234, 454]
    .map((index) => landmarks[index])
    .filter(Boolean);

  if (points.length < 4) {
    return null;
  }

  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);

  return { minX, minY, width, height };
}

function rotateUv(u: number, v: number, angle: number): Point2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centeredX = u - 0.5;
  const centeredY = v - 0.5;

  return {
    x: centeredX * cos - centeredY * sin + 0.5,
    y: centeredX * sin + centeredY * cos + 0.5,
  };
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  texture: HTMLImageElement,
  screenPoints: [DrawPoint, DrawPoint, DrawPoint],
  texturePoints: [Point2D, Point2D, Point2D],
) {
  const [p0, p1, p2] = screenPoints;
  const [t0, t1, t2] = texturePoints;
  const denominator = t0.x * (t2.y - t1.y) - t1.x * t2.y + t2.x * t1.y + (t1.x - t2.x) * t0.y;

  if (Math.abs(denominator) < 0.000001) {
    return;
  }

  const a = -(t0.y * (p2.x - p1.x) - t1.y * p2.x + t2.y * p1.x + (t1.y - t2.y) * p0.x) / denominator;
  const b = (t1.y * p2.y + t0.y * (p1.y - p2.y) - t2.y * p1.y + (t2.y - t1.y) * p0.y) / denominator;
  const c = (t0.x * (p2.x - p1.x) - t1.x * p2.x + t2.x * p1.x + (t1.x - t2.x) * p0.x) / denominator;
  const d = -(t1.x * p2.y + t0.x * (p1.y - p2.y) - t2.x * p1.y + (t2.x - t1.x) * p0.y) / denominator;
  const e = (t0.x * (t2.y * p1.x - t1.y * p2.x) + t0.y * (t1.x * p2.x - t2.x * p1.x) + (t2.x * t1.y - t1.x * t2.y) * p0.x) / denominator;
  const f = (t0.x * (t2.y * p1.y - t1.y * p2.y) + t0.y * (t1.x * p2.y - t2.x * p1.y) + (t2.x * t1.y - t1.x * t2.y) * p0.y) / denominator;

  context.save();
  context.beginPath();
  context.moveTo(p0.x, p0.y);
  context.lineTo(p1.x, p1.y);
  context.lineTo(p2.x, p2.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(texture, 0, 0);
  context.restore();
}

function drawFaceMesh(
  context: CanvasRenderingContext2D,
  texture: HTMLImageElement,
  landmarks: number[][],
  metrics: VideoDisplayMetrics,
  width: number,
  height: number,
  elapsedSeconds: number,
) {
  if (landmarks.length < 468) return;

  const uvBounds = computeUvBounds(landmarks);
  if (!uvBounds) return;

  const screenPoints = landmarks.map((point) => mapVideoPointToViewport(point, metrics, width, height));
  const textureRotation = elapsedSeconds * TEXTURE_ROTATION_SPEED;

  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 0.76;
  context.filter = 'saturate(1.18) contrast(1.1) brightness(1.08)';

  for (const [a, b, c] of FACE_TEXTURE_TRIANGLES) {
    const sourceA = landmarks[a];
    const sourceB = landmarks[b];
    const sourceC = landmarks[c];
    const screenA = screenPoints[a];
    const screenB = screenPoints[b];
    const screenC = screenPoints[c];

    if (!sourceA || !sourceB || !sourceC || !screenA || !screenB || !screenC) continue;

    const uvA = rotateUv((sourceA[0] - uvBounds.minX) / uvBounds.width, (sourceA[1] - uvBounds.minY) / uvBounds.height, textureRotation);
    const uvB = rotateUv((sourceB[0] - uvBounds.minX) / uvBounds.width, (sourceB[1] - uvBounds.minY) / uvBounds.height, textureRotation);
    const uvC = rotateUv((sourceC[0] - uvBounds.minX) / uvBounds.width, (sourceC[1] - uvBounds.minY) / uvBounds.height, textureRotation);
    const textureA = { x: uvA.x * texture.naturalWidth, y: uvA.y * texture.naturalHeight };
    const textureB = { x: uvB.x * texture.naturalWidth, y: uvB.y * texture.naturalHeight };
    const textureC = { x: uvC.x * texture.naturalWidth, y: uvC.y * texture.naturalHeight };

    drawTexturedTriangle(context, texture, [screenA, screenB, screenC], [textureA, textureB, textureC]);
  }

  context.filter = 'none';
  context.globalAlpha = 1;
}

export function ARFaceMaskOverlay() {
  const currentStage = useAppStore((s) => s.currentStage);
  const faceLandmarks = useAppStore((s) => s.faceLandmarks);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<HTMLImageElement | null>(null);
  const faceLandmarksRef = useRef<number[][] | null>(null);
  const animationRef = useRef<number>(0);
  const [textureReady, setTextureReady] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));

  useEffect(() => {
    faceLandmarksRef.current = faceLandmarks;
  }, [faceLandmarks]);

  useEffect(() => {
    const texture = new Image();
    texture.decoding = 'async';
    texture.src = QUESTION_FACE_TEXTURE;
    texture.onload = () => {
      textureRef.current = texture;
      setTextureReady(true);
    };

    return () => {
      textureRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const displayMetrics = useMemo(() => {
    return getVideoDisplayMetrics(viewportSize.width, viewportSize.height);
  }, [viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const texture = textureRef.current;
    if (currentStage !== 'QUESTIONING' || !canvas || !textureReady || !texture) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) return;

    const render = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(viewportSize.width * dpr));
      const height = Math.max(1, Math.round(viewportSize.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const landmarks = faceLandmarksRef.current;
      if (landmarks) {
        drawFaceMesh(context, texture, landmarks, displayMetrics, width, height, time / 1000);
      } else {
        context.clearRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationRef.current);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [currentStage, displayMetrics, textureReady, viewportSize.height, viewportSize.width]);

  if (currentStage !== 'QUESTIONING') {
    return null;
  }

  return <canvas ref={canvasRef} className="ar-face-mask-overlay ar-face-mask-overlay--mesh" aria-hidden="true" />;
}
