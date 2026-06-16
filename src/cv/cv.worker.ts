/**
 * CV WebWorker - 运行 MediaPipe FaceLandmarker + PoseLandmarker
 * 在 Worker 线程中运行以防阻塞主线程渲染
 */

import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

const ENABLE_FACE_TRACKING = true;
const ENABLE_HAND_TRACKING = true;

let faceLandmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;
let lastFrameTimestamp = 0;
let lastFaceTimestamp = 0;
let lastPoseTimestamp = 0;
let lastHandTimestamp = 0;
let lastFaceLandmarks: number[][] | null = null;
let lastPoseLandmarks: number[][] | null = null;
let lastHandLandmarks: number[][] | null = null;
let cachedFactory: any = null; // 用于缓存 ModuleFactory，防止 MediaPipe 初始化后将其清除

const FACE_INTERVAL_MS = 150;
const POSE_INTERVAL_MS = 80;
const HAND_INTERVAL_MS = 80;

async function initHandTracking(vision: any) {
  if (!ENABLE_HAND_TRACKING) {
    handLandmarker = null;
    lastHandLandmarks = null;
    return;
  }

  try {
    console.log('[Worker] HandLandmarker loading in background');
    // 恢复 ModuleFactory，防止之前的清除动作导致此步骤失败
    if (cachedFactory) {
      (globalThis as any).ModuleFactory = cachedFactory;
    }
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
    console.log('[Worker] HandLandmarker loaded');
  } catch (err) {
    handLandmarker = null;
    lastHandLandmarks = null;
    console.warn('[Worker] HandLandmarker failed to load:', err);
  }
}

function mapLandmarks(
  landmarks:
    | Array<{ x: number; y: number; z?: number }>
    | undefined
): number[][] | null {
  return landmarks?.map((landmark) => [landmark.x, landmark.y, landmark.z ?? 0]) ?? null;
}

async function initModels() {
  try {
    console.log('[Worker] Loading MediaPipe models...');
    
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    console.log('[Worker] FilesetResolver loaded');

    // Workaround: Manually fetch and eval the wasmLoaderPath to set globalThis.ModuleFactory in ES module WebWorkers
    const response = await fetch(vision.wasmLoaderPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM loader: ${response.status}`);
    }
    const scriptContent = await response.text();
    // Append global assignment to bypass strict mode eval variable scope isolation
    const patchedScript = scriptContent + '\nglobalThis.ModuleFactory = ModuleFactory;';
    (0, eval)(patchedScript);
    console.log('[Worker] WASM loader patched');

    // 缓存 ModuleFactory 实例，防止被 MediaPipe 内部清除
    cachedFactory = (globalThis as any).ModuleFactory;

    // 恢复 ModuleFactory
    if (cachedFactory) {
      (globalThis as any).ModuleFactory = cachedFactory;
    }
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
    console.log('[Worker] PoseLandmarker loaded');

    if (ENABLE_FACE_TRACKING) {
      // 恢复 ModuleFactory，防止上一步 PoseLandmarker 初始化时将其清除
      if (cachedFactory) {
        (globalThis as any).ModuleFactory = cachedFactory;
      }
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
      });
      console.log('[Worker] FaceLandmarker loaded');
    } else {
      faceLandmarker = null;
      lastFaceLandmarks = null;
    }

    handLandmarker = null;
    lastHandLandmarks = null;

    console.log('[Worker] Pose pipeline initialized successfully');
    self.postMessage({ type: 'ready' });

    void initHandTracking(vision);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Model initialization failed:', errorMsg);
    self.postMessage({ 
      type: 'error', 
      error: `Model loading failed: ${errorMsg}` 
    });
  }
}

function processFrame(imageBitmap: ImageBitmap) {
  if (!poseLandmarker) {
    imageBitmap.close();
    return;
  }

  const timestamp = performance.now();
  if (timestamp <= lastFrameTimestamp) {
    imageBitmap.close();
    return;
  }
  lastFrameTimestamp = timestamp;

  // 创建 OffscreenCanvas 进行处理
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    imageBitmap.close();
    return;
  }
  ctx.drawImage(imageBitmap, 0, 0);

  try {
    if (timestamp - lastPoseTimestamp >= POSE_INTERVAL_MS) {
      const poseResult = poseLandmarker.detectForVideo(canvas as unknown as HTMLVideoElement, timestamp);
      lastPoseLandmarks = mapLandmarks(poseResult.landmarks?.[0]);
      lastPoseTimestamp = timestamp;
    }

    if (ENABLE_FACE_TRACKING && faceLandmarker && timestamp - lastFaceTimestamp >= FACE_INTERVAL_MS) {
      const faceResult = faceLandmarker.detectForVideo(canvas as unknown as HTMLVideoElement, timestamp);
      lastFaceLandmarks = mapLandmarks(faceResult.faceLandmarks?.[0]);
      lastFaceTimestamp = timestamp;
    } else if (!ENABLE_FACE_TRACKING) {
      lastFaceLandmarks = null;
    }

    if (ENABLE_HAND_TRACKING && handLandmarker && timestamp - lastHandTimestamp >= HAND_INTERVAL_MS) {
      const handResult = handLandmarker.detectForVideo(canvas as unknown as HTMLVideoElement, timestamp);
      lastHandLandmarks = mapLandmarks(handResult.landmarks?.[0]);
      lastHandTimestamp = timestamp;
    } else if (!ENABLE_HAND_TRACKING) {
      lastHandLandmarks = null;
    }

    self.postMessage({
      type: 'result',
      payload: { faceLandmarks: lastFaceLandmarks, poseLandmarks: lastPoseLandmarks, handLandmarks: lastHandLandmarks },
    });
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  } finally {
    imageBitmap.close();
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  if (type === 'init') {
    try {
      await initModels();
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
  } else if (type === 'frame' && payload) {
    processFrame(payload);
  }
};
