# Remotion 参数 → TapCanvas 能力映射规则

## 总原则

原版卡的「动效核心」和「参数表」用**帧数和 JS 属性**描述，AI 模型读不懂。
翻译时只保留**感知意图**，丢掉工程实现。

> 错：「zoom 6f ease-in 急加速至 2.6，cx/cy 同步 ease-in 收敛到目标中心」  
> 对：「一拍之内急推到目标特写，落位过冲一下后快速弹回稳住」

---

## G 层（生成层）翻译规则

### 1. 帧数 → 感知时间词

| Remotion 帧数 | clipPrompt 写法 |
|---|---|
| 4–8f 急推 | 「一拍之内急推」「瞬间推近」 |
| 12f 快甩 | 「快速甩过」「一下甩向」 |
| 30f（约 1s） | 「约一秒」「一拍」 |
| ≥60f 慢推 | 「缓慢推进」「几秒内匀速拉近」 |

### 2. easing 类型 → 感知动势词

| easing | clipPrompt 写法 |
|---|---|
| ease-in（加速进） | 「加速冲向」「蓄力后猛」 |
| ease-out（减速停） | 「缓降停住」「滑行收住」 |
| ease-in-out（S 形） | 「平滑匀变速」 |
| spring 过冲回弹 | 「过冲后弹回」「弹性落稳」 |
| 指数衰减（撞停震屏） | 「撞停后余震数次迅速收干，不回弹」 |

### 3. 运镜参数 → 摄影语言

| Remotion 参数 | clipPrompt 写法 |
|---|---|
| zoom 1→2.6（急推特写） | 「从全景急推至特写，画面主体占据 60–75%」 |
| rotateY 16°（侧视角） | 「轻度侧视角，约 15–20°，纵深清晰」 |
| translateZ 纵深排开 | 「多个副本沿纵深排成队列」 |
| camera Y 轴拉升 | 「镜头缓慢上升揭示画面下方内容」 |
| 重景深（blur） | 「重景深，前景清晰，背景虚化」 |
| dutch-roll rotateZ | 「镜头向一侧倾斜后滚正」 |
| pull-back | 「镜头后退拉远，主体孤立在画面中央」 |

### 4. 速度比 → 节奏对比词

原则：保留**比例感知**，不写具体帧数。

| 原版参数 | clipPrompt 写法 |
|---|---|
| 快甩 12f vs 慢扫 48f（5:1） | 「快速甩过后以约五分之一的速度缓慢扫回」 |
| 快甩 vs 慢推（3:1 以上可感） | 「快速冲过后放慢节奏扫描细节」 |
| 递进减半（间隔递减） | 「剪切间隔逐渐缩短，节奏加速逼近」 |

### 5. 可感性阈值（原版坑，仍适用）

这些是**人的感知规律**，与 Remotion/TapCanvas 无关，翻译时保留：

- 副本 < 5 个：读不出「队」感，写 prompt 要明确说「清晰可数的多个副本」
- 速度对比 < 3:1：对比不可感，快慢差距要够大
- 过冲幅度 > 3-6%：才有弹性感（AI 生成时用「明显过冲后弹回」）
- 震屏幅度须「过肉眼阈值」：写「余震清晰可见、逐次衰减，约 3-4 次收干」
- 慢推 > 10f 才是「普通推近」：急推必须「真的快」

---

## C 层（合成层）xfade 映射表

`ConcatClipSpec.transition` 字段的合法值来自 ffmpeg xfade 支持的 58 种。
下面是卡→xfade 的标准映射，直接取用。

| shot-taxonomy 的 C 层卡 | transition 字段值 | 说明 |
|---|---|---|
| shot-transitions：推进流白 | `fadewhite` | 白场过渡 |
| shot-transitions：穿暗场/黑场字卡 | `fadeblack` | 黑场过渡 |
| wipe-transitions：clock-wipe 时钟扫 | `radial` | 雷达扫描圆形擦除 |
| wipe-transitions：blinds-slice 水平百叶 | `hlslice` | 水平条切换 |
| wipe-transitions：blinds-slice 垂直百叶 | `vdslice` | 垂直条切换 |
| bottom-push-stack-wipe | `slideup` | 底边向上推入 |
| circle-match-iris 开场 | `circleopen` | 圆心向外扩展 |
| circle-match-iris 收场 | `circleclose` | 圆形向中心收缩 |
| color-block-step-wipe（向左）| `wipeleft` | 从右向左擦除 |
| color-block-step-wipe（斜向）| `diagtl` | 从右下到左上对角擦除 |
| page-turn-transitions：barn-door-split | `vertopen` | 垂直对开 |
| print-texture-transitions：ink-bleed | `dissolve` | 溶解（近似洇开语义） |
| tear-streak-transitions：glitch | `pixelize` | 像素化故障感 |
| icon-field-colorize：扫翻款 | `wipedown` | 从上向下扫过 |

> **注意**：xfade duration（叠化时长）在 `resolveXfadeSeconds` 里全局设置。
> 建议合成层转场保持 0.3–0.6s（对应原版卡约 9–18 帧的过渡段）。
> 长于 0.8s 的叠化会让硬派擦除失去冲击感。

---

## 产品片特有规则

### 截图关键帧原则

产品片的 `startKeyframe`/`endKeyframe` 是**真实页面截图**，不是 AI 生图。
截图在以下位置采集：
1. 用浏览器截图工具截取产品真实页面（全页面/视口）
2. 上传到 R2，得到 URL，填进 BeatSheet 的 keyframe imageUrl
3. AI 视频模型基于这张截图做「图生视频」，只负责运镜/光影，不改 UI 内容

这样做的理由：AI 生成的 UI 文字不可读（像素糊），截图保留真实文字和精确布局。

### 哪些运镜适合截图图生视频

最佳：**摄影机运动为主、UI 本身静止的镜头**
- camera 全类（急推/俯拍/贴面游走/慢推/拉远）→ AI 在截图上跑机位
- lighting（聚光扫过/光斑显影）→ 截图叠光效
- opening 里的机位运动（crane-rise/spotlight-hero-card）

可用但效果有限：**主体有位移的镜头**（AI 会生成，但位移准确性无保证）

不适合：**ui-entrance / typography**（画框级精确帧，AI 拿不到）
