/**
 * Nebula Shader - 星云材质
 * 特征: 柔和的 FBM 体积感、缓慢旋涡、多层颜色混合
 */

import { noiseGLSL } from './noise.glsl';

export const nebulaVertex = /* glsl */ `
uniform float u_time;
uniform float u_noise_strength;
uniform float u_speed;
uniform float u_collapse;

varying vec3 vPosition;
varying float vDisplacement;
varying float vDepth;

${noiseGLSL}

void main() {
  vPosition = position;
  
  // 星云: 多层 FBM 产生柔和体积位移
  vec3 animPos = position + vec3(u_time * u_speed * 0.1, u_time * 0.05, 0.0);
  float noise = fbm(animPos * 1.5, 4);
  
  // 旋涡效果
  float angle = u_time * u_speed * 0.2;
  float swirl = snoise(vec3(position.xy * 2.0 + angle, position.z));
  
  vDisplacement = (noise + swirl * 0.3) * u_noise_strength;
  vDepth = position.z;
  
  // 坍缩
  float collapse = u_collapse;
  vec3 collapsed = position * (1.0 - collapse * 0.95);
  vec3 newPosition = collapsed + normalize(position) * vDisplacement * (1.0 - collapse);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  gl_PointSize = 2.0 + noise * 3.0 * (1.0 - collapse);
}
`;

export const nebulaFragment = /* glsl */ `
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_bloom_intensity;

varying vec3 vPosition;
varying float vDisplacement;
varying float vDepth;

${noiseGLSL}

void main() {
  // 星云: 柔和的径向渐变 + 噪声颜色调制
  float dist = length(gl_PointCoord - 0.5);
  if (dist > 0.5) discard;
  
  float softEdge = 1.0 - smoothstep(0.2, 0.5, dist);
  
  // 多层颜色
  float colorMix = (vDisplacement + 1.0) * 0.5;
  colorMix += snoise(vPosition * 3.0 + u_time * 0.1) * 0.2;
  vec3 color = mix(u_color_a, u_color_b, clamp(colorMix, 0.0, 1.0));
  
  // 深度雾化
  float fog = smoothstep(-1.5, 1.5, vDepth) * 0.3 + 0.7;
  
  // 发光核心
  float glow = u_bloom_intensity * softEdge * 1.5;
  color += vec3(glow * 0.2, glow * 0.1, glow * 0.3);
  
  gl_FragColor = vec4(color * fog, softEdge * 0.85);
}
`;

export const nebulaColors: [string, string] = ['#8800ff', '#ff00cc'];
