/**
 * MirrorFace - 3D 全息数字面孔（React Three Fiber & Three.js）
 *
 * 替换原本的 Canvas 2D，用 3D 全息线框面具进行渲染：
 *   - 3D 兜帽外壳背板 + 霓虹发光前圈
 *   - 数学解析生成的 3D 低多边形 (Low-poly) 面部网格，并硬切镂空出双眼与嘴巴
 *   - 鼠标实时跟随转头 (Mouse Tracking)
 *   - 随 speak 状态产生高频 3D 震颤与呼吸缩放
 *   - 3D 下落的代码雨粒子流
 */

import { useEffect, useRef, useMemo, useState, type CSSProperties } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { createBestEffortWebGLRenderer, WebGLCanvasGuard } from '../WebGLCanvasGuard';
import { useTTSAudioLevel } from '../../hooks/useTTSAudioLevel';
import { useAppStore } from '../../store/useAppStore';

// 全局缓存，用于支持随机 GLB 文件加载和多 Canvas 间独立克隆渲染
const cachedModels = new Map<string, THREE.Group>();
const cachedPromises = new Map<string, Promise<THREE.Group>>();

export function preloadFaceModel(filename: string): Promise<THREE.Group> {
  const cached = cachedModels.get(filename);
  if (cached) return Promise.resolve(cached);

  const existingPromise = cachedPromises.get(filename);
  if (existingPromise) return existingPromise;

  const loader = new GLTFLoader();
  const url = `/model/${filename}`;
  console.log(`[GLB Loader] Global background loading started for ${url}...`);
  
  const promise = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        console.log(`[GLB Loader] Global loading for ${filename} completed successfully!`);
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) {
              mesh.geometry.computeVertexNormals();
            }
          }
        });
        cachedModels.set(filename, gltf.scene);
        resolve(gltf.scene);
      },
      (xhr) => {
        if (xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          console.log(`[GLB Loader] Load progress for ${filename}: ${pct}%`);
        }
      },
      (err) => {
        console.error(`[GLB Loader] Global load error for ${filename}:`, err);
        cachedPromises.delete(filename); // 允许失败后重试
        reject(err);
      }
    );
  });

  cachedPromises.set(filename, promise);
  return promise;
}

interface Props {
  baseType: string;
  isSpeaking: boolean;
}

export type MaskKey = 'Crystal' | 'Nebula' | 'Plasma' | 'Flora' | 'Singularity';

type ThemeConfig = {
  primary: string;
  secondary: string;
  hoodDark: string;
};

export const THEMES: Record<MaskKey, ThemeConfig> = {
  Flora: {
    primary: '#22c55e',      // 绿 (咕噜/Flora)
    secondary: '#a7f3d0',
    hoodDark: '#030805',
  },
  Plasma: {
    primary: '#f97316',      // 橙 (机器人/Plasma)
    secondary: '#fed7aa',
    hoodDark: '#080503',
  },
  Nebula: {
    primary: '#d946ef',      // 粉紫 (星云/Nebula)
    secondary: '#fbcfe8',
    hoodDark: '#080308',
  },
  Singularity: {
    primary: '#06b6d4',      // 青蓝 (深渊/Singularity)
    secondary: '#cffafe',
    hoodDark: '#020508',
  },
  Crystal: {
    primary: '#0ea5e9',      // 冰蓝 (水晶/Crystal)
    secondary: '#bae6fd',
    hoodDark: '#02060c',
  },
};

export function resolveMaskKey(baseType: string): MaskKey {
  if (baseType === 'Flora') return 'Flora';
  if (baseType === 'Plasma') return 'Plasma';
  if (baseType === 'Nebula') return 'Nebula';
  if (baseType === 'Singularity') return 'Singularity';
  return 'Crystal';
}

export function MirrorFaceFallback({ baseType, isSpeaking }: Props) {
  const maskKey = resolveMaskKey(baseType);
  const theme = THEMES[maskKey];
  const style = {
    '--mask-primary': theme.primary,
    '--mask-secondary': theme.secondary,
    '--mask-dark': theme.hoodDark,
  } as CSSProperties;

  return (
    <div className={`mirror-face-fallback${isSpeaking ? ' mirror-face-fallback--speaking' : ''}`} style={style}>
      <div className="mirror-face-fallback__aura" />
      <div className="mirror-face-fallback__hood" />
      <div className="mirror-face-fallback__ring" />
      <div className="mirror-face-fallback__face">
        <span className="mirror-face-fallback__eye mirror-face-fallback__eye--left" />
        <span className="mirror-face-fallback__eye mirror-face-fallback__eye--right" />
        <span className="mirror-face-fallback__mouth" />
      </div>
      <div className="mirror-face-fallback__scanner" />
    </div>
  );
}

/** 3D 兜帽组件：使用半圆柱模拟兜帽深色内腔与霓虹亮边 */
function Hood3D({ color, darkColor }: { color: string; darkColor: string }) {
  const meshRef = useRef<THREE.Mesh>(null!);

  const geom = useMemo(() => {
    // radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength
    return new THREE.CylinderGeometry(1.2, 1.35, 2.2, 24, 6, true, 0, Math.PI);
  }, []);

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y = Math.PI / 2; // 面朝前
      meshRef.current.position.set(0, 0, -0.3); // 放在面部稍微靠后一点
    }
  }, []);

  return (
    <group>
      {/* 兜帽背景板 */}
      <mesh ref={meshRef} geometry={geom}>
        <meshStandardMaterial
          color={darkColor}
          roughness={0.9}
          metalness={0.1}
          side={THREE.DoubleSide}
          transparent
          opacity={0.95}
        />
      </mesh>
      
      {/* 兜帽边缘的霓虹光环 */}
      <mesh position={[0, 0.05, -0.28]} scale={[1.2, 1.05, 1]}>
        <ringGeometry args={[1.18, 1.2, 32, 1, 0, Math.PI]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function ScanningLine3D({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(state.clock.getElapsedTime() * 2.5) * 0.95;
  });

  return (
    <mesh ref={ref} position={[0, 0, 0.1]}>
      <torusGeometry args={[0.92, 0.012, 8, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  );
}

function AudioReactiveRing3D({
  primaryColor,
  secondaryColor,
  isSpeaking,
  audioLevel,
}: {
  primaryColor: string;
  secondaryColor: string;
  isSpeaking: boolean;
  audioLevel: number;
}) {
  const lineRef = useRef<THREE.Line>(null!);
  const innerHaloRef = useRef<THREE.Mesh>(null!);
  const outerHaloRef = useRef<THREE.Mesh>(null!);
  const segmentCount = 96;

  const [positions, angles] = useMemo(() => {
    const nextPositions = new Float32Array((segmentCount + 1) * 3);
    const nextAngles = new Float32Array(segmentCount + 1);

    for (let index = 0; index <= segmentCount; index++) {
      const angle = (index / segmentCount) * Math.PI * 2;
      nextAngles[index] = angle;
      nextPositions[index * 3] = Math.cos(angle) * 1.16;
      nextPositions[index * 3 + 1] = Math.sin(angle) * 1.16;
      nextPositions[index * 3 + 2] = 0.08;
    }

    return [nextPositions, nextAngles];
  }, []);

  const ringGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, [positions]);

  const ringMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: primaryColor,
      transparent: true,
      opacity: 0.36,
    });
  }, [primaryColor]);

  const ringLine = useMemo(() => {
    return new THREE.Line(ringGeometry, ringMaterial);
  }, [ringGeometry, ringMaterial]);

  useEffect(() => {
    return () => {
      ringGeometry.dispose();
      ringMaterial.dispose();
    };
  }, [ringGeometry, ringMaterial]);

  useFrame((state) => {
    if (!lineRef.current) {
      return;
    }

    const time = state.clock.getElapsedTime();
    const energy = isSpeaking ? 0.22 + audioLevel * 0.78 : 0.05 + audioLevel * 0.35;
    const positionAttr = ringGeometry.getAttribute('position') as THREE.BufferAttribute;
    const array = positionAttr.array as Float32Array;

    for (let index = 0; index <= segmentCount; index++) {
      const angle = angles[index];
      const ripple = Math.sin(angle * 8 - time * 10) * 0.034 * energy;
      const scan = Math.cos(angle * 3 + time * 2.3) * 0.012;
      const sparks = Math.max(0, Math.sin(angle * 24 + time * 16)) * 0.018 * energy;
      const radius = 1.16 + ripple + scan + sparks + energy * 0.05;

      array[index * 3] = Math.cos(angle) * radius;
      array[index * 3 + 1] = Math.sin(angle) * radius;
      array[index * 3 + 2] = 0.08 + Math.sin(angle * 10 + time * 6) * 0.035 * energy;
    }

    positionAttr.needsUpdate = true;

    const lineMaterial = lineRef.current.material as THREE.LineBasicMaterial;
    lineMaterial.opacity = 0.22 + energy * 0.62;

    if (innerHaloRef.current) {
      const material = innerHaloRef.current.material as THREE.MeshBasicMaterial;
      const scale = 1 + energy * 0.12 + Math.sin(time * 7.5) * 0.018 * (0.4 + energy);
      innerHaloRef.current.scale.set(scale, scale, 1);
      material.opacity = 0.08 + energy * 0.2;
    }

    if (outerHaloRef.current) {
      const material = outerHaloRef.current.material as THREE.MeshBasicMaterial;
      const scale = 1 + energy * 0.2 + Math.cos(time * 4.6) * 0.022 * (0.5 + energy);
      outerHaloRef.current.scale.set(scale, scale, 1);
      material.opacity = 0.05 + energy * 0.14;
    }
  });

  return (
    <group position={[0, 0.02, 0.16]} rotation={[0, 0, Math.PI * 0.08]}>
      <mesh ref={outerHaloRef}>
        <ringGeometry args={[1.18, 1.24, 96]} />
        <meshBasicMaterial
          color={secondaryColor}
          transparent
          opacity={0.1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={innerHaloRef}>
        <ringGeometry args={[1.02, 1.06, 96]} />
        <meshBasicMaterial
          color={primaryColor}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <primitive ref={lineRef} object={ringLine} />
    </group>
  );
}

/** 核心三维场景组件：处理鼠标跟随、发声抖动、数学生成面罩几何体 */
export function ScenePreset({ 
  maskKey, 
  isSpeaking, 
  isDormant = false, 
  showScanner = false,
  motionMode = 'ambient',
  hideHood = false,
}: { 
  maskKey: MaskKey; 
  isSpeaking: boolean; 
  isDormant?: boolean; 
  showScanner?: boolean; 
  motionMode?: 'ambient' | 'tracked';
  hideHood?: boolean;
}) {
  const theme = THEMES[maskKey];
  const audioLevel = useTTSAudioLevel();
  const groupRef = useRef<THREE.Group>(null!);

  // 状态：用于存放异步载入的自定义 GLB 脸谱模型
  const [customModel, setCustomModel] = useState<THREE.Group | null>(null);
  const selectedMaskFile = useAppStore((s) => s.selectedMaskFile);

  // 获取全局预加载的模型克隆实例，根据选取的随机模型文件名动态进行载入与切换
  useEffect(() => {
    if (!selectedMaskFile) return;
    let active = true;

    const cached = cachedModels.get(selectedMaskFile);
    if (cached) {
      console.log(`[GLB Loader] Cache hit for ${selectedMaskFile}. Cloning model scene.`);
      const clone = cached.clone(true);
      const box = new THREE.Box3().setFromObject(clone);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      clone.position.sub(center);
      if (maxDim > 0) clone.scale.setScalar(1.5 / maxDim);
      setCustomModel(clone);
      return;
    }

    preloadFaceModel(selectedMaskFile)
      .then((modelScene) => {
        if (active) {
          console.log(`[GLB Loader] Async load completed for ${selectedMaskFile}. Cloning model scene.`);
          const clone = modelScene.clone(true);

          // 自动归一化：将任意坐标系的模型居中并缩放至相机可视范围（1.5 单位球）
          const box = new THREE.Box3().setFromObject(clone);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          clone.position.sub(center);
          if (maxDim > 0) {
            clone.scale.setScalar(1.5 / maxDim);
          }

          setCustomModel(clone);
        }
      })
      .catch((err) => {
        console.error(`[GLB Loader] Load promise rejected for ${selectedMaskFile}:`, err);
      });

    return () => {
      active = false;
    };
  }, [selectedMaskFile]);

  // 动态更新自定义模型的材质属性（保留原始材质和贴图，呈现最真实炫酷的换脸效果）
  useEffect(() => {
    if (!customModel) return;
    
    customModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((mat: any) => {
            if (isDormant) {
              mat.transparent = true;
              mat.opacity = 0.15;
            } else {
              // 保证双面渲染以展现模型的原始背面深度
              mat.side = THREE.DoubleSide;
              // 保持原模型精美的贴图与不透明度，不强制转化为低透明度线框
            }
          });
        }
      }
    });
  }, [customModel, isDormant]);
  // 帧更新逻辑（鼠标跟随旋转 + 飘浮）
  useFrame((state) => {
    if (!groupRef.current) return;
    const { x, y } = state.pointer;
    const time = state.clock.getElapsedTime();

    if (motionMode === 'tracked') {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.18);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.18);
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, 0.18);
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.2);
    } else if (isDormant) {
      groupRef.current.rotation.y = time * 0.15;
      groupRef.current.rotation.x = Math.sin(time * 0.5) * 0.08;
      groupRef.current.position.y = Math.sin(time * 0.8) * 0.03;
    } else {
      const swayY = Math.sin(time * 0.8) * 0.08;
      const swayX = Math.cos(time * 0.6) * 0.04;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, x * 0.4 + swayY, 0.05);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, -y * 0.3 + swayX, 0.05);
      groupRef.current.position.y = Math.sin(time * 1.6) * 0.04;
    }

    if (isSpeaking) {
      groupRef.current.position.y += Math.sin(time * 32.0) * (motionMode === 'tracked' ? 0.0035 : 0.012);
      groupRef.current.scale.setScalar(1.0 + Math.sin(time * 26.0) * (motionMode === 'tracked' ? 0.01 : 0.022));
    } else {
      groupRef.current.scale.setScalar(1.0);
    }
  });

  return (
    <group>
      {/* 3D 兜帽背景底座 */}
      {!hideHood && <Hood3D color={isDormant ? '#111628' : theme.primary} darkColor={theme.hoodDark} />}

      {!isDormant && (
        <AudioReactiveRing3D
          primaryColor={theme.primary}
          secondaryColor={theme.secondary}
          isSpeaking={isSpeaking}
          audioLevel={audioLevel}
        />
      )}

      {/* 3D 面孔网格组合 */}
      <group ref={groupRef}>
        {customModel ? (
          <primitive object={customModel} />
        ) : null}

        {showScanner && <ScanningLine3D color={theme.primary} />}
      </group>
    </group>
  );
}

export function MirrorFace({ baseType, isSpeaking }: Props) {
  const maskKey = resolveMaskKey(baseType);
  const fallback = <MirrorFaceFallback baseType={baseType} isSpeaking={isSpeaking} />;

  return (
    <div
      className="mirror-face-canvas-container"
      style={{
        width: '260px',
        height: '260px',
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#020408',
        boxShadow: `0 0 35px ${THEMES[maskKey].primary}2b`,
        border: `1px solid ${THEMES[maskKey].primary}22`,
      }}
    >
      <WebGLCanvasGuard fallback={fallback}>
        <Canvas
          camera={{ position: [0, 0, 2.4], fov: 50 }}
          gl={(canvas) => createBestEffortWebGLRenderer(canvas as HTMLCanvasElement)}
          dpr={[1, 1.5]}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[5, 5, 5]} intensity={1.5} />
          <ScenePreset maskKey={maskKey} isSpeaking={isSpeaking} />
        </Canvas>
      </WebGLCanvasGuard>
    </div>
  );
}