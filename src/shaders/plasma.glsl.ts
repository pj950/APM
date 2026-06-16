/**
 * Plasma Shader - 等离子材质
 * 特征: 高速脉冲、尖锐闪光、高能粒子喷射
 */

import { noiseGLSL } from './noise.glsl';

export const plasmaVertex = /* glsl */ `
uniform float u_time;
uniform float u_noise_strength;
uniform float u_speed;
uniform float u_collapse;

varying vec3 vPosition;
varying float vDisplacement;
varying float vEnergy;

${noiseGLSL}

void main() {
  vPosition = position;
  
  // 等离子: 高频噪声 + 脉冲波
  float highFreq = snoise(position * 5.0 + u_time * u_speed * 2.0);
  float pulse = sin(u_time * u_speed * 4.0 + length(position) * 8.0) * 0.5;
  
  // 电弧闪烁
  float arc = pow(abs(snoise(position * 8.0 + u_time * 3.0)), 3.0);
  
  vDisplacement = (highFreq + pulse * 0.5 + arc) * u_noise_strength;
  vEnergy = arc + abs(highFreq);
  
  // 坍缩
  float collapse = u_collapse;
  vec3 collapsed = position * (1.0 - collapse * 0.95);
  
  // 等离子喷射方向: 沿法线 + 随机偏移
  vec3 jitter = vec3(
    snoise(position * 10.0 + u_time),
    snoise(position * 10.0 + u_time + 100.0),
    snoise(position * 10.0 + u_time + 200.0)
  ) * 0.3;
  
  vec3 newPosition = collapsed + (normalize(position) + jitter) * vDisplacement * (1.0 - collapse);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  gl_PointSize = 1.0 + arc * 5.0 * (1.0 - collapse);
}
`;

export const plasmaFragment = /* glsl */ `
uniform float u_time;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_bloom_intensity;

varying vec3 vPosition;
varying float vDisplacement;
varying float vEnergy;

void main() {
  float dist = length(gl_PointCoord - 0.5);
  if (dist > 0.5) discard;
  
  // 等离子: 高能粒子发光
  float core = 1.0 - smoothstep(0.0, 0.3, dist);
  float corona = 1.0 - smoothstep(0.0, 0.5, dist);
  
  // 颜色: 高能区域趋向白色
  vec3 baseColor = mix(u_color_a, u_color_b, vDisplacement * 0.5 + 0.5);
  vec3 hotColor = vec3(1.0, 0.9, 0.7); // 白热色
  vec3 color = mix(baseColor, hotColor, vEnergy * 0.6);
  
  // 闪烁
  float flicker = sin(u_time * 20.0 + vPosition.x * 50.0) * 0.1 + 0.9;
  
  float glow = u_bloom_intensity * core * 2.0 * flicker;
  color += vec3(glow);
  
  float alpha = corona * (0.7 + vEnergy * 0.3);
  gl_FragColor = vec4(color, alpha);
}
`;

export const plasmaColors: [string, string] = ['#ff4400', '#ffcc00'];
