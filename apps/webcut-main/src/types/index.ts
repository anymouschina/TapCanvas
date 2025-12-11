import { AVCanvas } from '@webav/av-canvas';
import { VisibleSprite, MP4Clip, ImgClip, AudioClip } from '@webav/av-cliper';

export type WebCutContext = {
    // 项目id
    id: string;

    // canvas 宽度
    width: number;
    // canvas 高度
    height: number;

    // canvas容器
    viewport: HTMLDivElement | null;
    // avcanvas 实例
    canvas: AVCanvas | null;
    // 素材对象列表，key为素材id
    clips: Array<MP4Clip | ImgClip | AudioClip>;
    // 素材列表，即经过剪辑后可用于播放的素材列表，key为素材id
    sprites: Array<VisibleSprite>;
    // 记录素材与原始素材的对应关系
    sources: Map<string, WebCutSource>;

    // 当前播放位置，纳秒，1000*1000=1秒
    cursorTime: number;
    // 是否播放中, -1: 停止， 0: 暂停/初始态， 1: 播放
    status: -1 | 0 | 1;

    // 禁用选中素材
    disableSelectSprite: boolean;
    // 当结束停止时，自动reset为第一帧
    autoResetWhenStop: boolean;

    // 帧率
    fps: number;

    // 时间轴缩放比例, [0, 100], step:10
    scale: number;

    /** 时间轴滚动条1 */
    scroll1: null | any;
    /** 时间轴滚动条2 */
    scroll2: null | any;
    /** 时间轴标尺 */
    ruler: null | any;
    /** 时间轴管理器 */
    manager: null | any;

    /** 播放器 */
    player: any | null;

    /** 轨 */
    rails: WebCutRail[];
    /** 选中的segment */
    selected: {
        segmentId: string;
        railId: string;
    }[];
    /** 当前选中的segment id，用于编辑区域编辑 */
    current: null | string;

    canUndo: boolean;
    canRedo: boolean;
    canRecover: boolean;

    // Loading status
    loading: boolean;
};

export type WebCutHighlightOfText = {
    id: string;
    content: string;
    start: number;
    end: number;
    css: any;
}

export type WebCutSegmentOfText = WebCutSegment & {
    text: string;
    css?: any;
    highlights?: WebCutHighlightOfText[];
}

export type WebCutRailOfText = WebCutRail & {
    segments: WebCutSegmentOfText[];
    css?: any;
    print_mode?: string;
    print_css?: any;
}

export type WebCutSegment = {
    id: string;
    start: number;
    end: number;
    /** 存到sources中的key */
    sourceKey: string;
    [key: string]: any;
};

export type WebCutRail = {
    id: string;
    type: WebCutMaterialType;
    segments: WebCutSegment[];
    mute?: boolean;
    hidden?: boolean;
    locked?: boolean;
    [key: string]: any;
};

// 素材类型定义
export type WebCutMaterialType = 'video' | 'audio' | 'image' | 'text';

export interface WebCutMaterial {
  id: string;
  name: string;
  type: WebCutMaterialType;
  url: string;
  size: number;
  duration?: number; // 视频和音频的时长
  width?: number; // 图片和视频的宽度
  height?: number; // 图片和视频的高度
  createdAt: number;
  updatedAt: number;
};

// 动画类型定义
export enum WebCutAnimationType {
    /** 入场动画 */
    Enter = 'enter',
    /** 出场动画 */
    Exit = 'exit',
    /** 运动动画 */
    Motion = 'motion',
};

// 动画可控制的属性
export interface WebCutAnimationProps {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    angle?: number;
    opacity?: number;
}

// 关键帧定义，key 为百分比或 from/to
export type WebCutAnimationKeyframe = Partial<Record<`${number}%` | 'from' | 'to', WebCutAnimationProps>>;

// 动画配置
export interface WebCutAnimationData {
    /** 动画类型 */
    type: WebCutAnimationType;
    /** 动画名称，preset id */
    key: string;

    /** 动画持续时间（微秒） */
    duration: number;
    /** 动画延迟时间（微秒） */
    delay?: number;
    /** 动画重复次数，0为无限循环 */
    iterCount?: number;
}

/**
 * 预设动画效果
 */
export interface WebCutAnimationPreset {
    /** 预设ID */
    key: string;
    /** 预设名称（用于展示） */
    name: string;
    /** 适用的动画类型 */
    type: WebCutAnimationType;
    /** 动画帧定义 */
    defaultKeyframe: Partial<Record<`${number}%` | 'from' | 'to', {
        /** 相对于素材当前位置的x偏移量 */
        offsetX?: number;
        /** 相对于素材当前位置的y偏移量 */
        offsetY?: number;
        /** 相对于当前w,h的缩放比例 */
        scale?: number;
        /** 相对于当前angle的旋转角度 */
        rotate?: number;
        /** 透明度 */
        opacity?: number;
    }>>;
    /** 默认持续时间（微秒） */
    defaultDuration: number;
    /** 默认重复次数 */
    defaultIterCount?: number;
}

/**
 * 素材元数据
 * 用于存储素材的位置信息、透明度、可见性等
 * 需要注意，当素材存在animation时，meta中的上述元数据信息与sprite上的真实值可能会有差异，
 * 因为animation会实时调整sprite的属性值，而元数据则保存了不考虑animation下的初始值，
 * 切换任意的animation都是在初始值的基础上进行叠加，而非在上一个animation的值的基础上叠加
 */
export type WebCutMaterialMeta = {
    id?: string;

    /** 素材的位置信息 */
    rect?: Partial<{
        x: number;
        y: number;
        w: number;
        h: number;
        angle: number;
    }>,
    zIndex?: VisibleSprite['zIndex'];
    opacity?: VisibleSprite['opacity'];
    flip?: VisibleSprite['flip'];
    visible?: VisibleSprite['visible'];
    interactable?: VisibleSprite['interactable'];

    time?: {
        /** 在时间轴中的开始时间 */
        start?: number;
        /** 在时间轴中的持续时间 */
        duration?: number;
        /** 播放速率，1为正常速率，0.5为半速，2为双倍速 */
        playbackRate?: number;
    },

    /** 动画 */
    animation?: WebCutAnimationData | null;

    audio?: {
        /** 偏移时间，即音频将从该位置进行播放，单位：纳秒 */
        offset?: number;
        volume?: number;
        loop?: boolean;
    },
    video?: {
        /** 偏移时间，即视频将从该位置进行播放，单位：纳秒 */
        offset?: number;
        volume?: number;
    },
    text?: {
        css?: object;
        highlights?: WebCutHighlightOfText[];
    },

    /** 滤镜配置数组，支持包含参数的对象形式 */
    filters?: Array<{
        key: string;
        params?: Record<string, any>;
    }>;

    /** 自动调整视频尺寸到容器内，仅对视频和图片有效，带_scale后缀表示当图片小于视频视口时，会把图片放大以撑满整个视口 */
    autoFitRect?: 'contain' | 'cover' | 'contain_scale' | 'cover_scale';
    /** 添加到指定轨道 */
    withRailId?: string;
    /** 用指定id作为新segment的id，主要用在恢复之前的历史记录时 */
    withSegmentId?: string;
};

export type WebCutSource = {
    key: string;
    type: WebCutMaterialType;
    clip: MP4Clip | ImgClip | AudioClip;
    sprite: VisibleSprite;
    text?: string;
    fileId?: string;
    url?: string;
    segmentId: string;
    railId: string;
    meta: WebCutMaterialMeta;
};

// 将source数据化，用于存储到db
export type WebCutSourceData = Omit<WebCutSource, 'clip' | 'sprite'> & {
    sprite: {
        time: VisibleSprite['time'];
        rect: {
            x: VisibleSprite['rect']['x'],
            y: VisibleSprite['rect']['y'],
            w: VisibleSprite['rect']['w'],
            h: VisibleSprite['rect']['h'],
            angle: VisibleSprite['rect']['angle'],
        };
        zIndex: VisibleSprite['zIndex'];
        opacity: VisibleSprite['opacity'];
        flip: VisibleSprite['flip'];
        visible: VisibleSprite['visible'];
        interactable: VisibleSprite['interactable'];
    },
    clip: {
        meta: MP4Clip['meta'] | ImgClip['meta'] | AudioClip['meta'];
    },
};

/** 项目状态数据，存在数据库中 */
export type WebCutProjectState = {
    historyAt: string;
    aspectRatio: string;
};

export type WebCutProjectHistoryState = {
    rails: WebCutRail[];
    sources: Record<string, WebCutSourceData>;
};

export type WebCutProjectHistoryData = {
    id: string;
    projectId: string;
    timestamp: number;
    state: WebCutProjectHistoryState;
}

export interface WebCutColors {
    primaryColor: string,
    primaryColorHover: string,
    primaryColorPressed: string,
    primaryColorSuppl: string,
    textColor: string,
    textColorHover: string,
    textColorDark: string,
    textColorDarkHover: string,

    backgroundColor: string,
    backgroundColorDark: string,
    greyColor: string,
    greyColorDark: string,
    greyDeepColor: string,
    greyDeepColorDark: string,

    railBgColor: string,
    railBgColorDark: string,
    /** 轨道悬停颜色 */
    railHoverBgColor: string,
    /** 轨道悬停颜色（暗色主题） */
    railHoverBgColorDark: string,
    lineColor: string,
    lineColorDark: string,
    thumbColor: string,
    thumbColorDark: string,
    managerTopBarColor: string,
    managerTopBarColorDark: string,
    closeIconColor: string,
    closeIconColorDark: string,
}