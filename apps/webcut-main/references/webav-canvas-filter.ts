// @ts-nocheck

import { AVCanvas } from '@webav/av-canvas';
import { VisibleSprite, MP4Clip, ImgClip, IClip } from '@webav/av-cliper';

// 定义滤镜类型
export type FilterType =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'hue-rotate'
  | 'invert'
  | 'saturate'
  | 'pixelate';

// 定义滤镜参数
export interface FilterParams {
  intensity?: number; // 通用强度参数 0.0-1.0
  radius?: number; // 模糊半径 0.0-10.0
  angle?: number; // 色相旋转角度 0-360
  value?: number; // 亮度/对比度/饱和度等参数
}

// 定义完整滤镜配置
export interface FilterConfig {
  type: FilterType;
  params: FilterParams;
}

// 定义视频帧处理函数类型
export type VideoFrameProcessor = (frame: VideoFrame) => Promise<VideoFrame>;

// WebGL 着色器滤镜配置
export interface GLSLFilterConfig {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, any>;
}

/**
 * 视频帧滤镜处理器
 * 使用 tickInterceptor 拦截视频帧并应用滤镜效果
 */
export class VideoFrameFilter {
  /**
   * 对视频帧应用 CSS 滤镜
   * @param frame 输入视频帧
   * @param filterConfig 滤镜配置
   * @returns 处理后的视频帧
   */
  static async applyCSSFilter(frame: VideoFrame, filterConfig: FilterConfig): Promise<VideoFrame> {
    const {
      type,
      params: { intensity = 0.5, radius = 2, angle = 0, value = 1.0 }
    } = filterConfig;

    // 创建离屏画布
    const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // 绘制原始帧
    ctx.drawImage(frame, 0, 0);

    // 构建 CSS 滤镜字符串
    let filterStr = '';
    switch (type) {
      case 'grayscale':
        filterStr = `grayscale(${intensity * 100}%)`;
        break;
      case 'sepia':
        filterStr = `sepia(${intensity * 100}%)`;
        break;
      case 'blur':
        filterStr = `blur(${radius}px)`;
        break;
      case 'brightness':
        filterStr = `brightness(${value})`;
        break;
      case 'contrast':
        filterStr = `contrast(${value})`;
        break;
      case 'hue-rotate':
        filterStr = `hue-rotate(${angle}deg)`;
        break;
      case 'invert':
        filterStr = `invert(${intensity * 100}%)`;
        break;
      case 'saturate':
        filterStr = `saturate(${value})`;
        break;
      case 'pixelate':
        const size = Math.floor(intensity * 20);
        filterStr = `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="pixelate"><feFlood x="0" y="0" width="${size}" height="${size}" result="tile"/><feComposite in="tile" in2="SourceGraphic" operator="in" result="composite"/><feMorphology operator="dilate" radius="${size/2}" in="composite" result="morph"/><feComposite in="morph" in2="SourceGraphic" operator="in"/></filter></svg>#pixelate')`;
        break;
      case 'none':
      default:
        // 不应用滤镜
        break;
    }

    // 应用滤镜
    if (filterStr) {
      ctx.filter = filterStr;
      ctx.drawImage(canvas, 0, 0);
    }

    // 创建新的视频帧
    const processedFrame = new VideoFrame(canvas, {
      timestamp: frame.timestamp
    });

    return processedFrame;
  }

  /**
   * 对视频帧应用 WebGL 着色器滤镜
   * @param frame 输入视频帧
   * @param glslConfig WebGL 着色器配置
   * @returns 处理后的视频帧
   */
  static async applyGLSLFilter(frame: VideoFrame, glslConfig: GLSLFilterConfig): Promise<VideoFrame> {
    // 创建离屏画布
    const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      throw new Error('WebGL not supported');
    }

    // 绘制原始帧到临时画布，以便 WebGL 读取
    const tempCanvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
      throw new Error('Failed to get temporary canvas context');
    }
    tempCtx.drawImage(frame, 0, 0);

    // 创建纹理
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 编译着色器
    const compileShader = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Shader compilation error: ' + gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, glslConfig.vertexShader);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, glslConfig.fragmentShader);

    // 创建程序
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program linking error: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // 设置顶点缓冲区
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // 设置顶点属性
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // 设置纹理坐标
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0
    ]);
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // 设置 uniforms
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture')!, 0);

    // 设置自定义 uniforms
    Object.entries(glslConfig.uniforms).forEach(([name, value]) => {
      const location = gl.getUniformLocation(program, name);
      if (location) {
        if (typeof value === 'number') {
          gl.uniform1f(location, value);
        }
        // 支持更多 uniform 类型...
      }
    });

    // 绘制
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 创建新的视频帧
    const processedFrame = new VideoFrame(canvas, {
      timestamp: frame.timestamp
    });

    // 清理资源
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteTexture(texture);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteBuffer(texCoordBuffer);

    return processedFrame;
  }
}

// WebAV 滤镜管理器类
export class WebAVFilterManager {
  private canvas: AVCanvas | null = null;
  private sprites: Map<string, { sprite: VisibleSprite; clip: IClip }> = new Map();
  private currentFilter: Map<string, FilterConfig | GLSLFilterConfig> = new Map();

  /**
   * 初始化 AVCanvas
   * @param container 容器元素
   * @param options 画布选项
   */
  initCanvas(container: HTMLElement, options?: {
    bgColor?: string;
    width?: number;
    height?: number;
  }): AVCanvas {
    this.canvas = new AVCanvas(container, {
      bgColor: options?.bgColor || '#000',
      width: options?.width || 800,
      height: options?.height || 600
    });
    return this.canvas;
  }

  /**
   * 从视频创建 Sprite
   * @param id Sprite 唯一标识符
   * @param videoSource 视频源 (URL 或 ReadableStream)
   */
  async createSpriteFromVideo(id: string, videoSource: string | ReadableStream): Promise<VisibleSprite> {
    if (!this.canvas) {
      throw new Error('Canvas not initialized');
    }

    let clip;
    if (typeof videoSource === 'string') {
      const response = await fetch(videoSource);
      clip = new MP4Clip(response.body!);
    } else {
      clip = new MP4Clip(videoSource);
    }

    const sprite = new VisibleSprite(clip);
    await this.canvas.addSprite(sprite);

    this.sprites.set(id, { sprite, clip });
    return sprite;
  }

  /**
   * 从图片创建 Sprite
   * @param id Sprite 唯一标识符
   * @param imgSource 图片源 (URL 或 HTMLImageElement)
   */
  async createSpriteFromImage(id: string, imgSource: string | HTMLImageElement): Promise<VisibleSprite> {
    if (!this.canvas) {
      throw new Error('Canvas not initialized');
    }

    let clip;
    if (typeof imgSource === 'string') {
      clip = new ImgClip(imgSource);
    } else {
      clip = new ImgClip(imgSource);
    }

    const sprite = new VisibleSprite(clip);
    await this.canvas.addSprite(sprite);

    this.sprites.set(id, { sprite, clip });
    return sprite;
  }

  /**
   * 应用预设滤镜到指定 Sprite
   * @param spriteId Sprite 唯一标识符
   * @param filterConfig 滤镜配置
   */
  applyFilter(spriteId: string, filterConfig: FilterConfig): void {
    const spriteData = this.sprites.get(spriteId);
    if (!spriteData) {
      throw new Error(`Sprite with id "${spriteId}" not found`);
    }

    this.currentFilter.set(spriteId, filterConfig);

    // 设置 tickInterceptor 来处理视频帧
    spriteData.clip.tickInterceptor = async (_, tickRet) => {
      if (tickRet.video) {
        const originalFrame = tickRet.video;
        try {
          // 应用滤镜
          const filteredFrame = await VideoFrameFilter.applyCSSFilter(originalFrame, filterConfig);
          tickRet.video = filteredFrame;
        } finally {
          originalFrame.close(); // 确保原始帧被关闭
        }
      }
      return tickRet;
    };
  }

  /**
   * 应用自定义 WebGL 着色器滤镜到指定 Sprite
   * @param spriteId Sprite 唯一标识符
   * @param glslConfig WebGL 着色器配置
   */
  applyGLSLFilter(spriteId: string, glslConfig: GLSLFilterConfig): void {
    const spriteData = this.sprites.get(spriteId);
    if (!spriteData) {
      throw new Error(`Sprite with id "${spriteId}" not found`);
    }

    this.currentFilter.set(spriteId, glslConfig);

    // 设置 tickInterceptor 来处理视频帧
    spriteData.clip.tickInterceptor = async (_, tickRet) => {
      if (tickRet.video) {
        const originalFrame = tickRet.video;
        try {
          // 应用 WebGL 滤镜
          const filteredFrame = await VideoFrameFilter.applyGLSLFilter(originalFrame, glslConfig);
          tickRet.video = filteredFrame;
        } finally {
          originalFrame.close(); // 确保原始帧被关闭
        }
      }
      return tickRet;
    };
  }

  /**
   * 应用自定义视频帧处理器到指定 Sprite
   * @param spriteId Sprite 唯一标识符
   * @param processor 自定义视频帧处理函数
   */
  applyCustomProcessor(spriteId: string, processor: VideoFrameProcessor): void {
    const spriteData = this.sprites.get(spriteId);
    if (!spriteData) {
      throw new Error(`Sprite with id "${spriteId}" not found`);
    }

    // 设置自定义 tickInterceptor
    spriteData.clip.tickInterceptor = async (_, tickRet) => {
      if (tickRet.video) {
        const originalFrame = tickRet.video;
        try {
          // 应用自定义处理器
          const processedFrame = await processor(originalFrame);
          tickRet.video = processedFrame;
        } finally {
          originalFrame.close(); // 确保原始帧被关闭
        }
      }
      return tickRet;
    };
  }

  /**
   * 更新滤镜参数
   * @param spriteId Sprite 唯一标识符
   * @param params 新的滤镜参数
   */
  updateFilterParams(spriteId: string, params: FilterParams): void {
    const currentConfig = this.currentFilter.get(spriteId);
    if (!currentConfig) {
      throw new Error(`No filter applied to sprite "${spriteId}"`);
    }

    if ('type' in currentConfig) {
      // 更新预设滤镜
      this.applyFilter(spriteId, {
        type: currentConfig.type,
        params: {
          ...currentConfig.params,
          ...params
        }
      });
    }
  }

  /**
   * 移除指定 Sprite 的滤镜
   * @param spriteId Sprite 唯一标识符
   */
  removeFilter(spriteId: string): void {
    const spriteData = this.sprites.get(spriteId);
    if (!spriteData) {
      throw new Error(`Sprite with id "${spriteId}" not found`);
    }

    // 清除 tickInterceptor
    spriteData.clip.tickInterceptor = undefined;
    this.currentFilter.delete(spriteId);
  }

  /**
   * 移除所有滤镜
   */
  removeAllFilters(): void {
    this.sprites.forEach((spriteData) => {
      spriteData.clip.tickInterceptor = undefined;
    });
    this.currentFilter.clear();
  }

  /**
   * 获取指定 Sprite 的当前滤镜配置
   * @param spriteId Sprite 唯一标识符
   */
  getCurrentFilter(spriteId: string): FilterConfig | GLSLFilterConfig | undefined {
    return this.currentFilter.get(spriteId);
  }

  /**
   * 销毁指定 Sprite
   * @param spriteId Sprite 唯一标识符
   */
  async destroySprite(spriteId: string): Promise<void> {
    const spriteData = this.sprites.get(spriteId);
    if (!spriteData) {
      return;
    }

    if (this.canvas) {
      await this.canvas.removeSprite(spriteData.sprite);
    }

    this.sprites.delete(spriteId);
    this.currentFilter.delete(spriteId);
  }

  /**
   * 销毁所有资源
   */
  async destroy(): Promise<void> {
    for (const spriteId of this.sprites.keys()) {
      await this.destroySprite(spriteId);
    }

    this.canvas = null;
  }
}

// 预设 GLSL 着色器
export const GLSL_SHADERS = {
  // 灰度滤镜
  grayscale: {
    vertexShader: `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_intensity;
      varying vec2 v_texCoord;

      void main() {
        vec4 color = texture2D(u_texture, v_texCoord);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        vec4 grayColor = vec4(gray, gray, gray, color.a);
        gl_FragColor = mix(color, grayColor, u_intensity);
      }
    `,
    uniforms: {
      u_intensity: 0.5
    }
  },

  // 复古滤镜
  sepia: {
    vertexShader: `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_intensity;
      varying vec2 v_texCoord;

      void main() {
        vec4 color = texture2D(u_texture, v_texCoord);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        vec4 sepiaColor = vec4(
          gray * 1.2,
          gray * 1.0,
          gray * 0.8,
          color.a
        );
        gl_FragColor = mix(color, sepiaColor, u_intensity);
      }
    `,
    uniforms: {
      u_intensity: 0.5
    }
  }
};

// 使用示例
export async function webAVFilterExample() {
  // 1. 获取容器元素
  const container = document.getElementById('video-container');
  if (!container) return;

  // 2. 创建滤镜管理器
  const filterManager = new WebAVFilterManager();

  // 3. 初始化画布
  filterManager.initCanvas(container, {
    bgColor: '#000',
    width: 800,
    height: 600
  });

  try {
    // 4. 加载视频并创建 Sprite
    await filterManager.createSpriteFromVideo('main-video', 'video.mp4');

    // 5. 应用灰度滤镜
    filterManager.applyFilter('main-video', {
      type: 'grayscale',
      params: { intensity: 0.7 }
    });

    // 6. 稍后更新滤镜强度
    setTimeout(() => {
      filterManager.updateFilterParams('main-video', { intensity: 0.3 });
    }, 2000);

    // 7. 3秒后切换到复古滤镜
    setTimeout(() => {
      filterManager.applyFilter('main-video', {
        type: 'sepia',
        params: { intensity: 0.8 }
      });
    }, 3000);

    // 8. 5秒后应用 WebGL 灰度滤镜
    setTimeout(() => {
      filterManager.applyGLSLFilter('main-video', GLSL_SHADERS.grayscale);
    }, 5000);

    // 9. 7秒后移除滤镜
    setTimeout(() => {
      filterManager.removeFilter('main-video');
    }, 7000);

  } catch (error) {
    console.error('WebAV filter example error:', error);
  }
}

// 自定义滤镜处理器示例
export async function customFilterProcessorExample() {
  // 1. 获取容器元素
  const container = document.getElementById('video-container');
  if (!container) return;

  // 2. 创建滤镜管理器
  const filterManager = new WebAVFilterManager();

  // 3. 初始化画布
  filterManager.initCanvas(container, {
    bgColor: '#000',
    width: 800,
    height: 600
  });

  try {
    // 4. 加载视频并创建 Sprite
    await filterManager.createSpriteFromVideo('custom-filter-video', 'video.mp4');

    // 5. 应用自定义滤镜处理器
    filterManager.applyCustomProcessor('custom-filter-video', async (frame: VideoFrame) => {
      // 创建离屏画布
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      // 绘制原始帧
      ctx.drawImage(frame, 0, 0);

      // 应用自定义滤镜效果
      ctx.filter = 'hue-rotate(90deg) brightness(1.2)';
      ctx.drawImage(canvas, 0, 0);

      // 创建新的视频帧
      return new VideoFrame(canvas, {
        timestamp: frame.timestamp
      });
    });

  } catch (error) {
    console.error('Custom filter processor example error:', error);
  }
}
