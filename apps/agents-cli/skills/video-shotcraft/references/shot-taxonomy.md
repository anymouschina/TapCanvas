# 104 张镜头卡的 TapCanvas 落地分层判定表

> **覆盖范围**（对原版 104 个卡文件逐名核过）：76 张逐名出现在下方明细/说明里，
> 其余 28 张是 typography(14) + ui-entrance(14) —— 这两类 100% 属 X 层，
> 按类整段讲清为何出局 + 给同意图的 G 层替代，比逐条列 28 行更有用。
> **G/C 层（唯一可执行的两层）无一遗漏。**
>
> **判定标准**（三层互斥，逐卡定死）：
> - **G 生成层**：核心是**镜头运动、光影、变速、主体位移**——真实摄影语汇，
>   AI 视频模型（seedance/pixverse）能按自然语言生成。
> - **C 合成层**：核心是**两个画面之间的几何过渡**——能映射到 ffmpeg
>   `xfade` 的 58 种 transition 之一。
> - **X 不可行**：核心是**DOM/CSS 帧级精确动效**——元素级错峰、透明度梯度、
>   字符级动画、精确数值跳动、SVG path 插值。AI 生成拿不到这个精度，
>   ffmpeg 没有对应滤镜。**不降级硬凑**。
>
> 判定看的是**卡的核心是什么**，不是「能不能勉强做出点像的东西」。
> 一张卡若去掉不可行部分就丢了立卡理由，判 X。

## 汇总

| 类别 | G | C | X | 小计 |
|------|---|---|---|------|
| camera | 7 | 0 | 0 | 7 |
| rhythm | 8 | 0 | 2 | 10 |
| transition | 4 | 8 | 3 | 15 |
| effects | 6 | 0 | 4 | 10 |
| opening | 4 | 1 | 4 | 9 |
| outro | 2 | 0 | 3 | 5 |
| data | 1 | 0 | 7 | 8 |
| interaction | 2 | 0 | 9 | 11 |
| ui-entrance | 0 | 0 | 15 | 15 |
| typography | 0 | 0 | 14 | 14 |
| **合计** | **34** | **9** | **61** | **104** |

结论：**运镜/节奏层几乎全可用，UI/文字层几乎全不可用**。这正好是两个工具的
题材分界——原版做 UI 宣传片，TapCanvas 做镜头叙事。

可执行部分的真相源是下方 G/C 明细表和 `tapcanvas-mapping.md` 的 xfade 映射表
——那两处逐条核过 ffmpeg 8.1.1，是唯一能照着写参数的地方。

---

## camera（7 张，全 G）

纯摄影机运动，AI 模型的强项。

| 卡 | 层 | clipPrompt 落地要点 |
|----|----|--------------------|
| crash-zoom-punch | G | 急推 + 落位二选一：过冲回弹（弹性）或撞停震屏（重量）。撞停款写「到位即停，机身余震数下迅速收干，不回弹」 |
| depth-layer-moves | G | 两款分开写：多层视差横移（前中后三层速度梯度）／伪 dolly-zoom（主体大小钉死、背景膨胀压来） |
| graze-face-tour | G | 贴面低飞掠过，大倾角。悬浮元素随镜头行进先后贴落 |
| overhead-camera-moves | G | 俯拍抬正揭示／桌面横滑骤降扎入 |
| space-camera-moves | G | 爆炸分解沿纵深炸开再合体／无人机俯冲降落 |
| steep-tilt-glide | G | 镜不动物动：60° 侧立强透视，主体沿自身横面滑移掠过镜头，带速度重影 |
| tension-camera-moves | G | 四式全可用：冻结环绕／斜角滚正／慢推压迫／拉远孤立 |

## rhythm（10 张：8 G，2 X）

| 卡 | 层 | 说明 |
|----|----|------|
| beat-cut-moves | G | 硬切当节拍。递进硬切串靠 clip 时长递减实现（间隔减半），连闪定格靠 fadewhite 转场 |
| montage-rhythm-moves | G | 黑场蓄爆／三连咔哒特写／多米诺连锁 |
| rhythm-interrupt-moves | G | 三级跳切推近（三个同轴不同景别 clip 硬切）／频闪黑帧 |
| sakuga-timing-shift | G | 帧率量化突变：顿挫步进→逐帧丝滑冲刺。写「先以明显顿挫的分段跳步移动，高潮瞬间转为完全平滑的连续冲刺」 |
| smear-multiples | G | 高速横移拖清晰可数的半透明分身，落位收拢合一 |
| speed-ramp-freeze | G | 变速：快→极慢凝视→快。AI 模型支持速度曲线描述 |
| trailer-grammar-moves | G | 预告片语法：前置速剪钩子／字卡穿插（字卡需外部素材）／猛切入定 |
| panel-grid-moves | G | 漫画斜格三机位并列可做（生成时构图内含分格）；九宫格闪切填墙属 X，用时只取斜格款 |
| beat-step-list-theme-cycle | **X** | 三通道锁死同一拍点（行上移 + 胶囊换色 + 底色跟换），元素级精确同步 |
| spectrum-morph-ui | **X** | 下划线裂成竖条按频谱跳动，元素级音频驱动 |

## transition（15 张：4 G，8 C，3 X）

**C 层需要 `ConcatClipSpec.transition` 字段**（见 `tapcanvas-mapping.md` 的
合成层映射表）。

| 卡 | 层 | 落地 |
|----|----|------|
| shot-transitions | C+G | 六式分开：推进流白→`fadewhite`；穿暗场→`fadeblack`；虚焦接力→G（生成层虚焦）；黑场字卡→`fadeblack`+外部字卡；whip-pan 甩镜→G（生成层甩镜）；mask-wipe 穿窗→G |
| wipe-transitions | C | clock-wipe→`radial`；blinds-slice→`hlslice`/`vdslice` |
| bottom-push-stack-wipe | C | `slideup`（底边上推顶出旧场景，语义完全对应） |
| circle-match-iris | C | `circleopen`/`circleclose`。匹配剪辑的语义锚点靠两 clip 构图对齐（前后镜圆形元素同位） |
| color-block-step-wipe | C | `wipeleft`/`diagtl` 系。离散阶跃感损失（xfade 是连续插值），保留吞屏方向 |
| page-turn-transitions | C | barn-door-split→`vertopen`；cube-rotate 属 X（3D 立方体翻转无对应） |
| print-texture-transitions | C | ink-bleed→`dissolve`（渗边质感损失，保留洇开语义） |
| tear-streak-transitions | C | glitch-displace→`pixelize`（近似故障感，条带级撕裂损失） |
| transition-hidden-cut | G | 藏切点是**剪辑技巧不是滤镜**：前景遮挡/撞击/光峰时刻硬切。靠 clip 首尾帧设计实现，不需要 transition 字段 |
| transition-travel | G | 镜头钻进画面里的真实元素完成换景，生成层运镜 |
| line-carry-transition | G | 线条延伸出画+镜头跟移，全程无剪切，生成层运镜 |
| paper-plane-messenger | G | 纸飞机沿弧线飞行+镜头伴飞，生成层运镜 |
| bubble-swarm-takeover | **X** | 气泡群粒子幕布，粒子级动效 |
| card-flip-reveal | **X** | CSS 3D 翻面 + 侧棱高光带随角度移动 |
| card-flock-tumble | **X** | CSS 3D 多卡翻飞成阶梯 + 样条连续 |

## effects（10 张：6 G，4 X）

| 卡 | 层 | 说明 |
|----|----|------|
| light-play-moves | G | 光效三式：聚光扫过／单点扫光／撞停晕染。纯光影，AI 强项 |
| spotlight-sweep-moves | G | 暗场聚光显影三式，光到即亮光走即暗 |
| glow-flyline-moves | G | 暗场光斑底噪／飞线连接／同帧接力 |
| slam-entrance-moves | G | 高能砸入三式：透视急停／砸落／冲击爆发 |
| impact-feedback | G | 动漫打击帧（负片+集中线+色差）可生成；连招计数属 X（数字跳动） |
| line-boil | G | 轮廓每数帧轻微扭动的手绘呼吸感，AI 可按「手绘逐帧重描质感」生成 |
| icon-performance-moves | **X** | 图标级爆花确认+粒子，元素级 |
| riso-print-hits | **X** | 套印错位需双色版精确位移抖动 |
| fui-hud-moves | **X** | 一线展面/准星咬合，矢量图形精确动画 |
| brand-frame-snap | **X** | 画框同帧硬翻色+窗内布局同帧换，需 `overlay` |

## opening（9 张：4 G，1 C，4 X）

| 卡 | 层 | 说明 |
|----|----|------|
| crane-rise-reveal | G | 升降臂拉升揭示，纯机位运动 |
| dataviz-landscape-open | G | 暗场流线地景 + 重景深低速飞越 |
| spotlight-hero-card | G | 聚光扫过锁定 + 斜 45° 推进 |
| text-as-mask | G | 字内透出画面属 X，但「结尾字形放大溢出、内部画面接管全屏」的**推进接管**可生成；只取后半段 |
| icon-field-colorize | C | 品牌色横带扫翻全场→`wipedown`；图标点阵错峰浮现属 X。只取扫翻款 |
| brand-ink-open | **X** | 字标逐字压印 + 打字机副标 |
| letterspace-materialize | **X** | 字符笔画连续生长结晶 |
| stroke-segment-build | **X** | 标题拆十几段笔画乱序点亮 |
| magician-card-flourish | **X** | 星芒精确旋转 + 卡片自旋衰减弧线 |

## outro（5 张：2 G，3 X）

| 卡 | 层 | 说明 |
|----|----|------|
| outro-group-photo-launch | G | 元素飞来围合 + crane 落机位 + 舞台光金尘 |
| edit-hook-moves | G | 片尾定住后突插彩蛋再收，靠 clip 序列实现 |
| neon-triple-marquee | **X** | 三行反向匀速无限横滚巨字 |
| ui-strip-away-outro | **X** | UI 层层错峰蒸发 |
| ui-to-brand-morph | **X** | 图标翻扁绽放 + wordmark 逐字落定 |

## data（8 张：1 G，7 X）

数据可视化本质是**精确数值驱动的图形**，AI 生成不出可读的正确数字与图表。

| 卡 | 层 | 说明 |
|----|----|------|
| timeline-travel | G | 镜头沿刻度轴加速掠过 + 末刻度急停推近。**只有运镜是真的**，刻度卡片内容靠截图素材 |
| before-after-slider-scrub | **X** | 分割杆精确 scrub |
| chart-live-moves | **X** | 曲线实时写入 |
| gauge-readout-moves | **X** | 指针扫弧到真值 |
| odometer-digit-roll | **X** | 数位独立滚动停位 |
| particle-sand-fill | **X** | 粒子逐颗堆积成柱 |
| particle-celebrate-hits | **X** | 礼炮彩屑弹幕 |
| scroll-brake-moves | **X** | 长卷指数减速精准停位 |

## interaction（11 张：2 G，9 X）

交互演示的核心是**光标/输入/UI 响应的精确对应**，AI 生成不出可信的交互因果。

| 卡 | 层 | 说明 |
|----|----|------|
| input-trigger-moves | G | cursor-performance 的**点击推近**可生成（镜头推近，不是光标精度）；keycap-smash-cut 属 X |
| collab-cursor-moves | G | dialogue-duet 双光标暗场对话双人舞——这张是**当演员用**（靠近/绕位/灯光交接/放大成转场），本质是双主体调度+光影，可生成 |
| ai-stream-response | **X** | 证据行逐条汇入 |
| autolayout-gap-dial | **X** | 参数驱动布局精确推开 |
| canvas-materialize-moves | **X** | 跨容器变形 |
| command-palette-summon | **X** | 面板弹落+候选行错峰+实时收窄 |
| hashtag-to-pill-materialize | **X** | 打字+1 帧硬切变形 |
| segmented-thumb-hero | **X** | thumb 精确位移 |
| theme-switch-moves | **X** | 就地换肤边界扫过 |
| type-and-filter | **X** | 打字搜索+网格收敛 |
| voice-waveform-live | **X** | 64 根竖条随说话起伏 |

## ui-entrance（15 张，全 X）

全部是**元素级错峰入场**——克隆纵队、发牌甩入、逐张飞上摞起、错峰贴落、
网格翻面、SVG path 插值变形。这是 CSS/DOM 动效的核心地盘，AI 生成给不了
「7 个克隆体等距 + 透明度线性衰减」「每张落地压弹整摞 + 计数器跳一格」
这种精度。

同意图的 G 层替代：想要「规模感」用 `space-camera-moves` 爆炸分解；
想要「一览很多内容」用 `page-waterfall-wall` 的**镜头缓推**部分配真实截图
（差速无限滚动属 X，只取推镜）；想要「元素登场」用
`slam-entrance-moves` 或 `light-play-moves` 的光影显影。

## typography（14 张，全 X）

全部是**字符级动画**——逐字裂升、乱码解码、字重脉冲、卡拉OK填色、
翻牌屏、老虎机滚字、马克笔描画下划线、打字机。合成层无 `drawtext`，
生成层的 AI 模型画不出可读的正确中英文字（这是 AI 视频模型的已知硬伤）。

产品片的文案落地方案见 `product-pipeline.md`：交用户后期加，或用真实截图里
已有的文字。
