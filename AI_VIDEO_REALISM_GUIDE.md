# 🎥 AI 视频真实感十条原则

这些准则来自创作者实测总结，已经纳入 TapCanvas 的镜头拆解、Storyboard 与 Prompt 资产模板中。规划镜头、补充提示词或编写 AI 助手自定义命令时，都可以对照下列守则，确保生成结果看起来像真实摄影机拍摄。

---

## 01. 光影统一逻辑（Lighting Logic）
- **核心链条**：时间 → 天气 → 材质 → 反射/阴影 → 氛围。任何环节断裂都会显得假。
- 明确时间段：清晨（柔光、低角度、低色温）、黄金时刻（暖光、长影）、夜晚（人工多光源）。
- 光线方向与色温须一致：主光与影子方向同源；低角度偏暖、高角度偏冷。
- 天气影响反射：雨天地面反射强、霾天对比度下降、雾天空气质感增强。
- 材质反光呼应：水面清晰倒影、金属高光、玻璃折射透光。
- **TapCanvas 应用**：Storyboard 节点中标注「时间/天气/材质」，在 prompt 中写明主光角度、色温与反射材质；多镜头串联时沿用同一光影设定。

## 02. 手持镜头逻辑（Handheld Camera Realism）
- 真实画面一定带有人为抖动：完美稳定 = 假，0.8%~1.2% 微抖、≥1% 频率。
- 起稳/停稳存在 0.3s 惯性，焦点偶尔游离后自动回归。
- 抖动节奏模拟「呼吸 + 手部惯性 + 步伐」。
- **TapCanvas 应用**：在视频节点写入「handheld, micro jitter 1%, breathing sway」等提示词；若使用 Compose 节点，可把运动曲线设置为缓入缓出，最后加 0.3s 回稳。

## 03. 景深与对焦逻辑（Realistic Depth of Field）
- 推荐参数：35mm/50mm 镜头、f/2.0–2.8 浅景深、拉焦时间 ≈ 2 秒。
- 对焦过程是缓动曲线，而非瞬间完成；背景散景柔和，焦点切换需有加减速。
- **TapCanvas 应用**：Storyboard 里注明镜头焦距与拉焦节奏，在 prompt 中附「35mm shallow depth of field, focus pull over 2s」。合成节点可通过关键帧控制 DOF。

## 04. 光学瑕疵（Lens Imperfections）
- 不完美才可信：保持 5%–8% 暗角、轻微 Lens Flare、色散（Chromatic Aberration）、胶片颗粒（Film Grain）。
- **TapCanvas 应用**：在提示词或合成节点参数添加「subtle vignette 6%, mild flare, film grain」。做成模板后交给 AI 助手引用即可。

## 05. 微动作（Micro Motion）
- 角色动作链：稳定 → 扰动（被碰撞/动作）→ 补偿 → 恢复。
- 包含轻微纠偏（手腕、目光）、反应链（动作影响杯子、衣料）、动作与环境的微延迟。
- **TapCanvas 应用**：在 Scene 描述中写明「动作触发 → 道具反应 → 衣料延迟」，提示词中加入「micro gestures, delayed reaction」。必要时拆成多个镜头保证补偿过程完整。

## 06. 材质真实细节（Material Realism）
- 纹理：针织/皮革/牛仔等要写出材质词。
- 磨损：旧化、划痕、折痕、磨损。
- 反光：金属高光、玻璃透光。
- 灰尘/微瑕疵：画面不应过度干净。
- 材质与光交互：粗糙 → 漫反射；光滑 → 镜面；透明 → 折射/透射。
- **TapCanvas 应用**：节点参数中指定材质与磨损度，例如「aged leather jacket with fine creases」。利用资产面板补充纹理参考，再让视频节点引用该资产。

## 07. 环境动力（Wind / Air / Particles）
- 物理统一：风速、方向一致；头发→衣物→配件按顺序延迟反应。
- 加入可见粒子（灰尘、光束颗粒），动作必须与风力匹配。
- **TapCanvas 应用**：Storyboard 的 Environment 区写明风向/风速，Prompt 中加入「wind from left, hair-follow delay, suspended dust particles」。如需特效，可在 Compose 节点添加粒子层。

## 08. 摄影机逻辑（Camera Operator Intent）
- 模拟摄影师意图：镜头运动需有目标（示例 0–5s：0–2s 推进、2–3s 稳住、3–5s 通过遮挡收尾）。
- 机位高度约 1.6m（人眼视觉），利用前景遮挡制造空间层次，移动要有目的。
- **TapCanvas 应用**：在 Timeline 节点写出分秒动作，把镜头段落拆开放进 Storyboard；Prompt 中注明「camera move: push in, hold, wrap with parallax occlusion」。合成时对齐关键帧，避免随意乱飘。

## 09. 微剧情 + 瑕疵保留（Micro Narrative + Imperfections）
- 微剧情示例：手机提醒 → 看时间 → 公交驶来 → 躲避 → 上车。动作链有目的才可信。
- 瑕疵保留：胶片颗粒、快门倾斜（rolling shutter）、运动模糊、轻微去饱和或色偏。
- 结论：真实 ≠ 完美，「不完美」才能保留纪录感与现场感。
- **TapCanvas 应用**：在 Flow 中串联多个节点表达动作链，每个节点写清触发条件；导出时保留轻微 motion blur、grain，不要过度后期。

## 10. 音色与对白录制（Voice Timbre & Dialogue Realism）
- 明确音色：女中音/男中音/少年等，标注基频范围（示例：110–150Hz 男中音）与气声比例（示例：25% breathiness）。
- 口型与噪声：保留轻微口腔/唇舌噪声，避免过度降噪导致“塑料味”。
- 收声距离与空间：强调近讲（close-mic）、-16 LUFS 整体响度，轻微房间混响 RT60 ≈ 0.3–0.5s。
- **TapCanvas 应用**：在提示词加入「warm baritone, 25% breathiness, -16 LUFS, soft room reverb RT60 0.4s」，对白节点或视频节点都保持同一收声风格；如有角色对话，分别注明音色与语速。

---

### 🎯 快速使用方式
1. **Storyboard 模板**：复制该九条原则到 Storyboard 描述，勾选适合当前镜头的检查项。
2. **Prompt 片段**：把每条中的关键参数（如焦距、风向、微抖幅度）做成 Prompt 片段，存入资产面板，方便在不同节点引用。
3. **AI 助手记忆**：将本文链接添加到 AI 助手知识库或自定义命令，便于助手在生成提示词时自动补全「光影统一」「手持抖动」等要素。

> 💡 记得在多镜头流程里持续复用相同的设定（光源、镜头语言、微剧情逻辑），TapCanvas 才能帮你输出风格统一、真实可信的 AI 视频。
