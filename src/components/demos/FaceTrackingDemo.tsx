/**
 * FaceTrackingDemo —— 复刻 dilmerv/FaceTrackingDemo 的 Web 版本。
 *
 * 关键点：该 Unity 项目的“面具”不是 3D 模型，而是贴在 AR 人脸网格上的 2D 面部贴图
 * （Assets/Textures 下的 cartoon / humanface / virus1 / virus2 / uv / superheros）。
 * 因此这里也用 MindAR 的人脸网格 (addFaceMesh) 做载体，把这些 Unity 原始贴图 UV 映射到
 * 实时追踪的脸上，并每 5 秒自动轮换一张，对齐 Unity 里 ToggleFace 的切换演示。
 *
 * - MindAR (WebAR) 独占摄像头 + Three.js 渲染（CV 管线已在 useCVCapture 中排除 FACE_DEMO）。
 * - 贴图全部预加载，切换时只替换流动着色器的 uMap uniform，零延迟。
 * - 使用 Three.js 的 PBR MeshStandardMaterial 对齐 Unity Universal PBR；只通过 onBeforeCompile
 *   注入原 ShaderGraph 的 UV Rotate(Time) + texture ×2，避免手写五官阴影造成贴纸感。
 * - 原项目材质是 Opaque + Alpha=1，眼睛/嘴巴不是透明挖洞；Web 版同样保留整张动态 face mesh 覆盖。
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MindARThree } from 'mind-ar/dist/mindar-face-three.prod.js';
import { useAppStore } from '../../store/useAppStore';

/** 贴图自动轮换间隔（毫秒），对齐 Unity ToggleFace 演示 */
const FACE_SWITCH_INTERVAL_MS = 5000;

/** 来自 dilmerv/FaceTrackingDemo 的 Unity 原始面部贴图（已下载到 public/unity-face/textures） */
const UNITY_FACE_TEXTURES: Array<{ file: string; label: string }> = [
  { file: 'cartoon.png', label: 'Cartoon' },
  { file: 'superheros.jpg', label: 'Superheros' },
  { file: 'uv.png', label: 'UV Debug' },
];

type MindARFaceGeometry = THREE.BufferGeometry & {
  updatePositions?: (landmarks: number[][]) => void;
};

function patchForeheadCoverage(geometry: MindARFaceGeometry) {
  if (!geometry.updatePositions) return;

  const originalUpdatePositions = geometry.updatePositions.bind(geometry);
  const uv = geometry.getAttribute('uv');
  geometry.updatePositions = (landmarks: number[][]) => {
    originalUpdatePositions(landmarks);

    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!uv || !position) return;

    for (let i = 0; i < position.count; i += 1) {
      const v = uv.getY(i);
      const forehead = THREE.MathUtils.smoothstep(v, 0.64, 0.9);
      if (forehead <= 0) continue;

      position.setY(i, position.getY(i) + forehead * 1.25);
      position.setX(i, position.getX(i) * (1 + forehead * 0.035));
      position.setZ(i, position.getZ(i) + forehead * 0.08);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}

function createCartoonAnimatedMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map,
    color: new THREE.Color(1.0, 1.0, 1.0),
    emissive: new THREE.Color(0.0, 0.0, 0.0),
    emissiveIntensity: 0.0,
    metalness: 1.0,
    roughness: 0.305,
    envMapIntensity: 1.65,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uRotSpeed = { value: 0.85 };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uTime;
      uniform float uRotSpeed;

      vec2 rotateFaceUv(vec2 uv, float rot) {
        float c = cos(rot);
        float s = sin(rot);
        uv -= 0.5;
        uv = mat2(c, -s, s, c) * uv;
        uv += 0.5;
        return uv;
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 rotatedMapUv = rotateFaceUv(vMapUv, uTime * uRotSpeed);
        vec4 sampledDiffuseColor = texture2D(map, rotatedMapUv);
        sampledDiffuseColor.rgb *= 2.0;
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
    material.userData.shader = shader;
  };

  return material;
}

export function FaceTrackingDemo() {
  const setStage = useAppStore((s) => s.setStage);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [activeLabel, setActiveLabel] = useState<string>('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let mindarThree: MindARThree | null = null;
    let switchTimer: number | null = null;
    let environmentMap: THREE.Texture | null = null;
    const textures: THREE.Texture[] = [];

    const cleanup = () => {
      if (switchTimer !== null) {
        window.clearInterval(switchTimer);
        switchTimer = null;
      }
      try {
        mindarThree?.stop();
      } catch {
        /* 忽略停止异常 */
      }
      try {
        mindarThree?.renderer?.setAnimationLoop(null);
        mindarThree?.renderer?.dispose();
      } catch {
        /* 忽略渲染器释放异常 */
      }
      for (const tex of textures) tex.dispose();
      textures.length = 0;
      environmentMap?.dispose();
      environmentMap = null;
      mindarThree = null;
    };

    const run = async () => {
      try {
        mindarThree = new MindARThree({
          container,
          uiLoading: 'no',
          uiScanning: 'no',
          uiError: 'no',
          // 贴近 Unity ARFaceManager 的即时贴脸感：使用 MindAR 默认 OneEuro 参数，
          // 避免过度平滑造成“人已经动了，面具慢慢追上来”。
          filterMinCF: null,
          filterBeta: null,
        });

        const { scene, renderer } = mindarThree;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        const pmrem = new THREE.PMREMGenerator(renderer);
        environmentMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = environmentMap;
        pmrem.dispose();

        scene.add(new THREE.HemisphereLight(0xffffff, 0x1c2230, 1.15));
        const keyLight = new THREE.DirectionalLight(0xfff0d8, 2.15);
        keyLight.position.set(-1.8, 2.4, 3.2);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x88b8ff, 0.55);
        fillLight.position.set(2.2, 0.6, 1.6);
        scene.add(fillLight);

        // 预加载所有 Unity 面部贴图
        setLoadProgress({ done: 0, total: UNITY_FACE_TEXTURES.length });
        const loader = new THREE.TextureLoader();
        const loadOne = (file: string) =>
          new Promise<THREE.Texture | null>((resolve) => {
            loader.load(
              `${import.meta.env.BASE_URL}unity-face/textures/${file}`,
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false; // MindAR/MediaPipe 人脸网格 UV 与 glTF 一致，需关闭翻转
                setLoadProgress((p) => ({ done: p.done + 1, total: p.total }));
                resolve(tex);
              },
              undefined,
              (err) => {
                console.warn(`[FaceTrackingDemo] 贴图加载失败: ${file}`, err);
                setLoadProgress((p) => ({ done: p.done + 1, total: p.total }));
                resolve(null);
              },
            );
          });

        const loaded = await Promise.all(UNITY_FACE_TEXTURES.map((t) => loadOne(t.file)));
        if (disposed) return;

        const validIndices: number[] = [];
        loaded.forEach((tex, i) => {
          if (tex) {
            textures.push(tex);
            validIndices.push(i);
          }
        });
        if (textures.length === 0) {
          throw new Error('所有 Unity 面部贴图均加载失败');
        }

        // 人脸网格作为贴图载体（UV 映射到追踪到的脸上）
        const faceMesh = mindarThree.addFaceMesh();
        const faceGeometry = faceMesh.geometry as MindARFaceGeometry;
        patchForeheadCoverage(faceGeometry);
        const faceMaterial = createCartoonAnimatedMaterial(textures[0]);
        faceMesh.material = faceMaterial;
        // 注意：MindAR 的 addFaceMesh 只把 mesh 推入内部数组用于更新矩阵/可见性，
        // 并不会自动加入场景，必须手动 add，否则贴图永远不会被渲染。
        scene.add(faceMesh);

        // 启动摄像头 + 人脸追踪
        await mindarThree.start();
        if (disposed) return;

        const { camera } = mindarThree;
        const clock = new THREE.Clock();
        renderer.setAnimationLoop(() => {
          const shader = faceMaterial.userData.shader as { uniforms?: Record<string, { value: unknown }> } | undefined;
          if (shader?.uniforms?.uTime) shader.uniforms.uTime.value = clock.getElapsedTime();

          renderer.render(scene, camera);
        });

        // 自动轮换：替换流动材质的贴图 uniform
        let cursor = 0;
        const showFace = (idx: number) => {
          faceMaterial.map = textures[idx];
          faceMaterial.needsUpdate = true;
          const originalIndex = validIndices[idx];
          setActiveLabel(UNITY_FACE_TEXTURES[originalIndex].label);
        };
        showFace(cursor);

        if (textures.length > 1) {
          switchTimer = window.setInterval(() => {
            cursor = (cursor + 1) % textures.length;
            showFace(cursor);
          }, FACE_SWITCH_INTERVAL_MS);
        }

        setStatus('running');
      } catch (err) {
        if (disposed) return;
        console.error('[FaceTrackingDemo] 初始化失败', err);
        setErrorMessage(err instanceof Error ? err.message : '人脸追踪初始化失败');
        setStatus('error');
        cleanup();
      }
    };

    void run();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div className="face-demo">
      {/* MindAR 渲染容器（内部会创建 video + canvas） */}
      <div ref={containerRef} className="face-demo__stage" />

      {/* 顶部信息条 */}
      <div className="face-demo__hud">
        <button
          type="button"
          className="face-demo__back"
          onClick={() => setStage('STANDBY')}
        >
          ← 返回
        </button>
        <div className="face-demo__title">🎭 面部追踪演示 · Unity 面具贴图</div>
        {status === 'running' && activeLabel ? (
          <div className="face-demo__mask-name">{activeLabel}</div>
        ) : (
          <div className="face-demo__mask-name" />
        )}
      </div>

      {/* 加载/错误覆盖层 */}
      {status === 'loading' ? (
        <div className="face-demo__overlay">
          <div className="face-demo__spinner" />
          <div className="face-demo__overlay-text">
            正在加载面部贴图与摄像头…
            {loadProgress.total > 0 ? ` (${loadProgress.done}/${loadProgress.total})` : ''}
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="face-demo__overlay">
          <div className="face-demo__overlay-text face-demo__overlay-text--error">
            {errorMessage || '初始化失败'}
          </div>
          <button
            type="button"
            className="face-demo__back face-demo__back--inline"
            onClick={() => setStage('STANDBY')}
          >
            返回首页
          </button>
        </div>
      ) : null}
    </div>
  );
}
