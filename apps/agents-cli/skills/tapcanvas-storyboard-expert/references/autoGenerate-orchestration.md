## 自动生成编排（autoGenerate=true 时的智能编排）

当 `autoGenerate=true` **且本次运行具备画布生成工具**（chat / 编排模式，可调用 `tapcanvas_image_generate_to_canvas`、`tapcanvas_video_generate_to_canvas`、`tapcanvas_tasks_result` 等；受限 intent 流只能 add_node/connect_edge/finalize，**无法**自动跑视频），你作为导演**自己向后推导并执行完整链路，跑到所有视频任务完成才 finalize**（一键出片，含视频）。

### 🚫 不许中途停
- **做完锚点就停 = 失败。** 必须一路走完「锚点 → 故事板出图 → 拆镜 → 每镜出视频 → 全部 succeeded」。任一步只 `add_node` 不真正调用生成工具执行，都算没做完。
- 每个生成步骤都要**真正调用对应的 generate 工具并轮询 `tapcanvas_tasks_result` 至 succeeded** 再进入下一步，不要只创建空节点。

### 📐 布局规则（必须遵守，否则节点会横铺成长条/撑破组框）
- **新建的所有生成节点一律放顶层，不要设 parentId、不要塞进输入组**（输入组只装用户给的剧情/风格文本）。
- **不要给生成节点写死 position 坐标。** 画布会按节点 coreType 自动分列收拢（文本｜图片｜故事板｜视频 从左到右、同类型纵向单列），你手填坐标反而会把节点横铺成长条/撑破组框。省略 position，让画布自动排即可得到紧凑管线布局。

### 🚀 出图批量并发（开局排全量任务·无依赖必并发·2026-06-18 用户拍板）
- **开局先把整片要出的图一次排成任务清单**（已锁 style、由 `tapcanvas-character-card` 编译的 N 张角色卡、M 张场景卡、故事板设计板、各镜必要关键帧），按依赖分批，**不要边想边一张张串行出**。
- **`tapcanvas_image_generate_to_canvas` 支持 `nodes:[...]` 批量并发**（后端按 `imageGlobal` 上限=4 用 worker 池并发，把"逐张串行等 ~2min"压成"一批并发"）。**凡是互相无依赖的图，必须放进同一个 `nodes:[...]` 调用批量并发出，禁止一张一个工具调用串行刷。**
- **依赖感知分批（按此顺序）**：
  1. **项目画风事实**——先读取 style lock；项目尚未锁画风时按当前统一画风流程处理，禁止另造角色卡专用风格锚 URL。
  2. **全部角色卡 + 全部场景卡**——角色卡必须先由 `tapcanvas-character-card` 对完整 cast 做正交设计并编译独立身份；场景卡由对应场景 skill 编译。相互无依赖的节点按工具实时批量上限并发，项目画风由服务端自动注入。
  3. **故事板设计板**（多格线稿，单张/少量）。
  4. **逐镜关键帧**：`cut` 模式各镜独立 → 可批量并发；`continuous` 模式镜N首帧链镜N-1尾帧 → **有依赖，保持串行**。
- **唯一保持串行的是视频生成**（见步骤 4，undici 超时约束），**图片一律能并发就并发**。

### 执行步骤
> **模型分工**：角色卡模型与规格只由 `tapcanvas-character-card` 根据本轮 `enabledImageModels` 和账号生成偏好选择，本 reference 不写默认值。其他图片也应以实时模型目录为准；只有已经明确选择 gpt-image-2 时，才应用其防噪点工艺，不能把历史模型字符串当执行证据。
1. **锚点（一致性基石）**：从剧情抽全部角色/场景。角色卡只接受 `tapcanvas-character-card` 返回的 `character-card/v3` 数据；场景卡只接受 `tapcanvas-scene-card` 返回的 `scene-card/v1 + scene-lighting/v1` 数据。完整 cast 与完整 setting 组分别共同设计，再按实时批量上限并发生成并对账至 succeeded。不要从同一人物/场景母版裂变其它身份，也不要在本编排 reference 内补写角色、场景或灯光 prompt。
1.5 **建立一致性锁定卡（消除服装/光线/画风漂移——必做）**：从锚点+剧情定一张全局复用的「锁定卡」，三段写具体：
   - ①角色外观与**服装**：写死颜色款式，如「小男孩，黑色短发，身穿浅蓝色长袖睡衣套装」。
   - ②**光线**：一句固定，含色温/时间/环境，如「清晨自然光，明亮卫生间，冷白色调，柔和均匀」。
   - ③**风格**：如「写实电影剧照，真实肤质，自然色彩，浅景深」。
   这张卡**原文照搬**进后续每一张关键帧图、每一镜视频的 prompt，**不靠模型记忆**（OpenAI 官方：每次都要重复 preserve 清单才能防漂）。
2. **逐镜关键帧图（即视频剧情参考图 referenceImages，单张写实剧照）**：每镜调 `tapcanvas_image_generate_to_canvas` 出 2K **单张**关键帧。prompt 结构 = [锁定卡原文] +「本镜：<动作/景别/机位>。**只改动作与机位，服装/光线/色温/画风一律保持锁定卡不变**（change only action & camera, keep everything else identical）」+ 摄像机/灯光参数，轮询至 succeeded。
   - 🚫 **图像 prompt 禁用** storyboard / 分镜 / 线稿 / 网格 / grid / sketch / comic / 连环画 等词——会触发模型出插画/多格板而非实拍；一律说「写实电影剧照 / photorealistic film still」。（autoGenerate 视频管线里这些图是**单张关键帧（作 referenceImages 剧情参考）**，配方只贡献色调/氛围，**绝不要出多格故事板/网格**。）
   - 🔗 第 N≥2 张把**上一镜关键帧图**也加进 `referenceImages` 并注明「与上一帧同款服装、同光线」，逐帧 propagate 一致性。`referenceImages=[角色锚点, 场景锚点, (N≥2 时)上一镜关键帧]`。
3. **镜头表**：依 `durationSeconds` 拆成 N 镜（30s≈3–4 镜，单镜≤10s，合计=时长）。每镜定好：本镜关键帧图、运动提示词（前置锁定卡 + 摄像机/灯光/导演细节）、时长。
3.5. **镜头表独立 critic 自检（硬规则，不可跳过）**：拆完镜头表后**必须且只调用一次** `tapcanvas_shot_table_critic`（`reviewMode="text_storyboard"`、`shotTable`=准备交付的镜头表全文、`brief`=题材/风格简述），评审执行身份精确继承主代理本轮实际模型与协议，但使用独立评审上下文，返回 `{ pass, overallScore, issues, topFixes, perModel }`：
   - 无论 `pass` 值如何，都必须按 `topFixes` 逐条修订一次镜头表；修订后禁止再次调用文本分镜 critic。
   - 修订一轮后直接进入步骤 4；若仍有无法消解的 `issues`，在 summary 中如实标注，禁止伪造复评通过。
4. **逐镜图生视频（状态接力保证镜与镜连贯）——逐镜独立提交、统一回收**：
   - **每镜单独调一次 `tapcanvas_video_generate_to_canvas`**。工具在上游接单并把真实 `taskId` 写入 running 节点后立即返回，不等成片；禁止传 `submitOnly` / `waitForResult`，也禁止把多个镜头塞进一次调用。
   - 每镜 prompt 前置锁定卡原文 + 运动/机位/导演细节；本镜关键帧 + 角色/场景锚点一并作 `referenceImages` 剧情参考（不设首帧）；每镜 prompt 末尾追加「只保留同步真实音效/对白，不要任何持续 BGM」。
   - **镜 N≥2 承接上一镜**：先继承 `exitState` 与语义多锚点，再逐镜提交 `continuityMode`。普通剪辑用 `editorial_cut`；精确动作/形变 A→B 用预生成真实单格 `bridge_frames`；只有真实连续运镜、运动惯性或声场必须继承时用 `reference_video`。agent 不手写 `sourcePrevTaskId/chainFromPrev`，执行层从冻结模式派生。
   - 全部镜头提交后，对每次提交返回的真实 `nodeId + taskId` 分别按 8–15s 退避调用精确 `tapcanvas_video_reconcile`，直到该节点 `stillRunning=0`。禁止无参数扫描整张画布。`status:"running"` 是已接单，不是失败；同一 task/node 禁重新提交，后台 recovery worker 也会持续回写终态。只有节点明确 `failed` 时才按真实错误处理；每镜使用唯一 nodeId（id = `${prefix}-shot-${i+1}`）。
   - ⚠️ 模型键**必须用 `doubao-seedance-2-0-260128`**（new-api 模型目录注册名 "Seedance 2.0" 的 request-model）。别名 `doubao-seedance-2.0` 不在 `/api/models/list` 启用目录里，会被 `new_api_model_disabled` 拒。
5. **收尾自检**：finalize 前**逐一核对每个 shot 的视频节点都已有 `videoUrl`（status=succeeded）**。只要还有镜头没出视频，就回到第 4 步继续补跑剩余镜头，**绝不在视频未出齐时 finalize**。summary 列：配方、时长、镜头数、各镜视频状态、剧情走向。

约束：每镜运动提示词同样要过"摄像机+灯光+实拍+导演级"标准。`autoGenerate=false`（受限 intent 流）时**只**做故事板图节点，视频留给用户手动执行。
