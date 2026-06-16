/**
 * Flora Shader - 森罗材质
 * 特征: 有机生长、藤蔓延伸、自然呼吸节奏
 */

import { noiseGLSL } from './noise.glsl';

export const floraVertex = /* glsl */ `
uniform float u_time;
uniform float u_noise_strength;
uniform float u_speed;
uniform float u_collapse;

varying vec3 vPosition;
varying float vDisplacement;
varying float vGrowth;

${noiseGLSL}

void main() {
  vPosition = position;
  
  // 有机呼吸: 低频正弦调制
  float breath = sin(u_time * u_speed * 0.5) * 0.3 + 0.7;
  
  // 生长噪声: 从底部向上扩散
  float heightFactor = (position.y + 1.5) / 3.0; // 归一化高度
  float growth = fbm(position * 2.0 + vec3(0.0, -u_time * u_speed * 0.2, 0.0), 3);
  growth *= heightFactor; // 上方生长更多
  
  // 藤蔓缠绕
  float vine = sin(position.y * 6.0 + u_time * u_speed + position.x * 3.0) * 0.2;
  
  vDisplacement = (growth + vine) * u_noise_strength * breath;
  vGrowth = heightFactor;
  
  // 坍缩
  float collapse = u_collapse;
  vec3 collapsed = position * (1.0 - collapse * 0.9);
  
  // 有机方向: 混合法线和向上的趋势
  vec3 growDir = normalize(mix(normalize(position), vec3(0.0, 1.0, 0.0), 0.3));
  vec3 newPosition = collapsed + growDir * vDisplacement * (1.0 - collapse);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  gl_PointSize = 1.5 + growth * 2.5 * (1.0 - collapse);
}
`;

export const floraFragment = /* glsl */ `
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_bloom_intensity;

varying vec3 vPosition;
varying float vDisplacement;
varying float vGrowth;

${noiseGLSL}

void main() {
  float dist = length(gl_PointCoord - 0.5);
  if (dist > 0.5) discard;
  
  float softEdge = 1.0 - smoothstep(0.3, 0.5, dist);
  
  // 有机颜色渐变: 底部深色，顶部明亮
  vec3 color = mix(u_color_a, u_color_b, vGrowth);
  
  // 叶脉纹理
  float vein = abs(snoise(vPosition * 8.0 + u_time * 0.1));
  vein = smoothstep(0.3, 0.5, vein);
  color = mix(color, color * 1.5, vein * 0.3);
  
  // 生物荧光
  float biolum = pow(vGrowth, 2.0) * u_bloom_intensity * 0.8;
  float pulse = sin(u_time * 2.0 + vPosition.y * 4.0) * 0.5 + 0.5;
  color += vec3(0.0, biolum * pulse, biolum * pulse * 0.5);
  
  float alpha = softEdge * (0.6 + vGrowth * 0.4);
  gl_FragColor = vec4(color, alpha);
}
`;

export const floraColors: [string, string] = ['#004422', '#44ff88'];
