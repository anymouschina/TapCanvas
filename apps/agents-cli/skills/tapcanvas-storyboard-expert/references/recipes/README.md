# 故事板配方库（单一真相源）

每个子目录 = 一条配方：`recipe.md`（gptImagePromptTemplate + seedancePromptTemplate + invariants）。
`recipes.json` 是机器可读索引，被 hono-api `GET /storyboard/recipes` 读取返回给画布选择器。

## 预览图
`previewUrl` 指向 R2 托管的预生成 webp（用 gpt-image-2 各跑一次该配方的样例图，上传 R2 直链原图；⛔禁经 cdn-cgi/image 变体——CF 转换额度已耗尽，变体 URL 回 ERROR 9422）。
预览图是"风格样例"，与用户选定后生成的"实例"不同。新增预览 host 时同步加入 hono-api 的 CF_IMAGE_HOSTS。
