# 配方：影视叙事分镜（cinematic-narrative）

## 定位
影视级小说/漫剧**忠实改编**的连贯叙事分镜板。16:9，2×3 共 6 格，每格是一个真正的**镜头**（景别+机位+运镜），含**原文对白口播**，电影写实质感，**无漫画线条/无对白气泡/无字幕水印、无快切蒙太奇**。多角色多场景：角色取自组内角色卡、场景取自组内场景图，按格锁一致性。专治"每镜单帧、缺镜头轨迹/剧情走向"。

## gptImagePromptTemplate（生成 2K 故事板实例用）
生成一张 16:9 电影级故事板，2×3 共 6 格连贯分镜，从左到右、从上到下严格按剧情时间线阅读。**每格左下角小字标注镜头语言**：景别（远景/全景/中景/近景/特写）、机位与角度（平视/俯/仰/过肩/主观）、运镜（推/拉/摇/移/跟/升降/手持）。逐格按剧情节拍推进，体现镜头调度与情绪变化。角色严格取自组内角色卡，复刻其五官/发型/服饰/体型并逐格保持一致；场景严格取自组内场景图，保持环境/光线/色调一致。统一电影写实质感与色调。**禁止漫画线条、对白气泡、文字水印、字幕**。内容来自组内故事序列：[组内故事序列]。

## seedancePromptTemplate（下游图生视频复用）
Animate each panel into a continuous cinematic shot, following the panel's labeled camera language (景别/机位/运镜) for a real shot trajectory rather than a static pan. Preserve each character's identity from the bound character cards and keep scene/lighting consistency from the scene references. Smooth shot-to-shot continuity, ancient Chinese fantasy cinematic realism, coherent lighting and color grade. Where the beat carries dialogue, speak the original Chinese lines with realistic lip-sync. No subtitles, no comic bubbles, no flicker, no identity drift.

## invariants（三条横切不变量）
1. 网格优先、单图喂入；**每格 = 一镜**，必带景别+机位+运镜标注，镜头轨迹写进画面与下游 prompt（静帧只是首帧，运动靠镜头语言）。
2. 一致性三层：**角色**按角色卡锁五官/发型/服饰/体型、逐格固定外观；**场景**按场景图锁环境/光线/色调；全片统一色调与 16:9 比例。
3. 默认约束：16:9 避裁切、电影写实、**无漫画气泡/无字幕水印/无快切**；对白用**原文口播**；多角色多场景按格只放本格出场的人与景，全片各格加起来把素材用上。
