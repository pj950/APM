/**
 * Shader 材质注册表
 * 统一管理所有 archetype 对应的 shader 和颜色配置
 */

import { crystalVertex, crystalFragment, crystalColors } from './crystal.glsl';
import { nebulaVertex, nebulaFragment, nebulaColors } from './nebula.glsl';
import { plasmaVertex, plasmaFragment, plasmaColors } from './plasma.glsl';
import { floraVertex, floraFragment, floraColors } from './flora.glsl';
import type { VisualArchetype } from '../types';

export interface ShaderPreset {
  vertexShader: string;
  fragmentShader: string;
  colors: [string, string];
}

const presets: Record<VisualArchetype['baseType'], ShaderPreset> = {
  Crystal: { vertexShader: crystalVertex, fragmentShader: crystalFragment, colors: crystalColors },
  Nebula: { vertexShader: nebulaVertex, fragmentShader: nebulaFragment, colors: nebulaColors },
  Plasma: { vertexShader: plasmaVertex, fragmentShader: plasmaFragment, colors: plasmaColors },
  Flora: { vertexShader: floraVertex, fragmentShader: floraFragment, colors: floraColors },
  // Singularity 使用 Nebula 作为基础 + 特殊颜色
  Singularity: { vertexShader: nebulaVertex, fragmentShader: nebulaFragment, colors: ['#ffffff', '#111111'] },
};

export function getShaderPreset(baseType: VisualArchetype['baseType']): ShaderPreset {
  return presets[baseType] || presets.Crystal;
}
