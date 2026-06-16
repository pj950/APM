/**
 * 为 mind-ar 的深导入路径提供最小类型声明。
 * mind-ar 1.2.5 自身未携带 .d.ts，这里只声明本项目用到的 MindARThree API。
 */
declare module 'mind-ar/dist/mindar-face-three.prod.js' {
  import type { Group, Object3D, Scene, PerspectiveCamera, WebGLRenderer, Mesh } from 'three';

  export interface MindARFaceAnchor {
    group: Group;
    landmarkIndex: number;
    css: boolean;
    visible: boolean;
  }

  export interface MindARThreeOptions {
    /** MindAR 渲染挂载的容器元素 */
    container: HTMLElement;
    /** 是否显示内置加载 UI，"yes" | "no" */
    uiLoading?: string;
    /** 是否显示内置扫描 UI，"yes" | "no" */
    uiScanning?: string;
    /** 是否显示内置错误 UI，"yes" | "no" */
    uiError?: string;
    /** OneEuro 滤波最小截止频率，越小越平滑但越滞后 */
    filterMinCF?: number | null;
    /** OneEuro 滤波速度系数 */
    filterBeta?: number | null;
    /** 指定前置摄像头 deviceId */
    userDeviceId?: string | null;
    /** 指定后置摄像头 deviceId */
    environmentDeviceId?: string | null;
    /** 关闭镜像 */
    disableFaceMirror?: boolean;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);
    readonly renderer: WebGLRenderer;
    readonly scene: Scene;
    readonly camera: PerspectiveCamera;
    readonly video: HTMLVideoElement;
    /** 在指定面部关键点索引创建一个锚点，返回可挂载子对象的 group */
    addAnchor(landmarkIndex: number): MindARFaceAnchor;
    /** 添加用于遮挡的面部网格 */
    addFaceMesh(): Mesh;
    /** 启动摄像头与人脸追踪 */
    start(): Promise<void>;
    /** 停止追踪并释放摄像头 */
    stop(): void;
    /** 添加每帧渲染前回调 */
    [key: string]: unknown;
  }
}
