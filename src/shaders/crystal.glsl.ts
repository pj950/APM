/**
 * Crystal Shader - 晶体材质
 * 特征: 锐利的几何面、折射光芒、有序排列的顶点位移
 */

import { noiseGLSL } from './noise.glsl';

export const crystalVertex = /* glsl */ `
uniform float u_time;
uniform float u_noise_strength;
uniform float u_speed;
uniform float u_collapse;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vDisplacement;

${noiseGLSL}

void main() {
  vPosition = position;
  vNormal = normal;
  
  // 晶体: 量化噪声，产生棱角分明的效果
  float noise = snoise(position * 3.0 + u_time * u_speed * 0.3);
  noise = floor(noise * 5.0) / 5.0; // 量化为阶梯
  
  vDisplacement = noise * u_noise_strength;
  
  // 坍缩动画: u_collapse 0->1 时所有顶点向中心收缩
  float collapse = u_collapse;
  vec3 collapsed = position * (1.0 - collapse * 0.9);
  vec3 newPosition = collapsed + normal * vDisplacement * (1.0 - collapse);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  gl_PointSize = 1.5 + (1.0 - collapse) * 2.0;
}
`;

export const crystalFragment = /* glsl */ `
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_bloom_intensity;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vDisplacement;

void main() {
  // 晶体面状着色: 基于法线的硬边折射
  float facet = abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
  facet = floor(facet * 4.0) / 4.0;
  
  vec3 color = mix(u_color_a, u_color_b, facet);
  
  // 折射高光
  float highlight = pow(facet, 3.0) * u_bloom_intensity;
  color += vec3(highlight * 0.5);
  
  float alpha = 0.8 + vDisplacement * 0.2;
  gl_FragColor = vec4(color, alpha);
}
`;

export const crystalColors: [string, string] = ['#00ccff', '#0044ff'];
