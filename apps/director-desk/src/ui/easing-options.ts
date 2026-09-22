import { EASINGS, type AnimatedNumber, type Easing } from '../animation/channels.ts';
export const easingChoice = (value: Easing | undefined, fallback = 'linear') => typeof value === 'object' ? 'custom' : value ?? fallback;
export const easingChoices = (value: Easing | undefined): [string, string][] => [...Object.entries(EASINGS), ...(typeof value === 'object' ? [['custom', '自定义曲线'] as [string, string]] : [])];
export const chosenEasing = (choice: string, previous?: Easing): Easing => choice === 'custom' && typeof previous === 'object' ? structuredClone(previous) : choice as keyof typeof EASINGS;

export const keyEasing = (value: AnimatedNumber | undefined, index: number) => typeof value === "object" ? value.keys[index]?.easing : undefined;
