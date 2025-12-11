import { WebCutAnimationType, WebCutAnimationPreset } from '../types';

export const animationPresets: WebCutAnimationPreset[] = [
    {
        key: 'fadeIn',
        name: '淡入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { opacity: 0 },
            'to': { opacity: 1 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideInLeft',
        name: '从左滑入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { offsetX: -Infinity },
            'to': { offsetX: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideInRight',
        name: '从右滑入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { offsetX: Infinity },
            'to': { offsetX: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideInTop',
        name: '从上滑入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { offsetY: -Infinity },
            'to': { offsetY: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideInBottom',
        name: '从下滑入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { offsetY: Infinity },
            'to': { offsetY: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'zoomIn',
        name: '放大进入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { scale: 0 },
            'to': { scale: 1 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'rotateIn',
        name: '旋转进入',
        type: WebCutAnimationType.Enter,
        defaultKeyframe: {
            'from': { rotate: -180, opacity: 0 },
            'to': { rotate: 0, opacity: 1 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'fadeOut',
        name: '淡出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { opacity: 1 },
            'to': { opacity: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideOutLeft',
        name: '向左滑出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { offsetX: 0 },
            'to': { offsetX: -Infinity },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideOutRight',
        name: '向右滑出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { offsetX: 0 },
            'to': { offsetX: Infinity },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideOutTop',
        name: '向上滑出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { offsetY: 0 },
            'to': { offsetY: -Infinity },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'slideOutBottom',
        name: '向下滑出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { offsetY: 0 },
            'to': { offsetY: Infinity },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'zoomOut',
        name: '缩小退出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { scale: 1 },
            'to': { scale: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'rotateOut',
        name: '旋转退出',
        type: WebCutAnimationType.Exit,
        defaultKeyframe: {
            'from': { rotate: 0, opacity: 1 },
            'to': { rotate: 180, opacity: 0 },
        },
        defaultDuration: 2e6, // 2秒
    },
    {
        key: 'pulse',
        name: '脉冲',
        type: WebCutAnimationType.Motion,
        defaultKeyframe: {
            '0%': { scale: 1 },
            '50%': { scale: 1.1 },
            '100%': { scale: 1 },
        },
        defaultDuration: 1e6 * 0.2,
    },
    {
        key: 'shake',
        name: '抖动',
        type: WebCutAnimationType.Motion,
        defaultKeyframe: {
            '0%': { offsetX: 0 },
            '25%': { offsetX: -10 },
            '50%': { offsetX: 10 },
            '75%': { offsetX: -10 },
            '100%': { offsetX: 0 },
        },
        defaultDuration: 1e6 * 0.2,
    },
    {
        key: 'bounce',
        name: '弹跳',
        type: WebCutAnimationType.Motion,
        defaultKeyframe: {
            '0%': { offsetY: 0 },
            '25%': { offsetY: -50 },
            '50%': { offsetY: 0 },
            '75%': { offsetY: -25 },
            '100%': { offsetY: 0 },
        },
        defaultDuration: 1e6 * 0.8,
    },
    {
        key: 'swing',
        name: '摆动',
        type: WebCutAnimationType.Motion,
        defaultKeyframe: {
            '0%': { rotate: 0 },
            '25%': { rotate: 15 },
            '50%': { rotate: 0 },
            '75%': { rotate: -15 },
            '100%': { rotate: 0 },
        },
        defaultDuration: 1e6 * 0.8,
    },
    {
        key: 'flash',
        name: '闪烁',
        type: WebCutAnimationType.Motion,
        defaultKeyframe: {
            '0%': { opacity: 1 },
            '25%': { opacity: 0 },
            '50%': { opacity: 1 },
            '75%': { opacity: 0 },
            '100%': { opacity: 1 },
        },
        defaultDuration: 1e6,
    },
];
