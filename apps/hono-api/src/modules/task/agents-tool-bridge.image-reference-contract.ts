/** 单次付费媒体执行允许解析的图片引用上限；模型自身预算会在更下游继续收紧。 */
export const MAX_EXECUTION_IMAGE_REFERENCES = 16;

/**
 * 只读资产验真允许覆盖的章节级清单上限。该上限不代表任何单 clip 模型预算；
 * 服务端会按付费执行批大小确定性拆批并聚合无 URL descriptor。
 */
export const MAX_IMAGE_REFERENCE_INSPECTION_ITEMS = 256;

export const IMAGE_REFERENCE_INSPECTION_BATCH_SIZE = MAX_EXECUTION_IMAGE_REFERENCES;
