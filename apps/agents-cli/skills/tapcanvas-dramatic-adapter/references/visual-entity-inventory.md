# 视觉实体清单合同

## 目的

在切 beat 前完成一次章级语义盘点，确保“来源里有哪些对象”“此刻谁真实可见”“哪个稳定身份贯穿状态变化”先于镜头拆分成立。它修复两类高频错误：漏掉短暂出现但必须画出的实体，以及把对白提及、画外声音、屏幕内容或旧资产误当成当前物理空间主体。

清单只存在于当前 agent 执行链，是阅读与自检工作面；不得提交为新的 BeatSheet 根字段，不得要求 Hono/Web 用文本规则复算。最终事实写回现有合同。

## 每项最小工作字段

- `entityKey`：章内稳定键；同一实体的姓名、外号、代词、形态描述和状态版共用一个键。无法归并时使用临时键并标记 `unresolved`，不得猜。
- `canonicalName`：来自项目资产、角色总表或来源证据的权威名；没有权威名时保留来源称谓并说明证据边界。
- `kind`：`character / group / creature / scene / prop / vehicle / interface / environment / other`。
- `presence`：`visible / audible_only / mentioned_only / flashback_visible / unresolved`。
- `sourceEvidence`：可逐字定位的来源片段或已确认项目事实；不得只写推断结论。
- `visibilityRange`：首次与末次真实可见的来源单元或候选 beat；仅被提及的实体不填写伪可见范围。
- `stateFacts`：服装、形态、伤势、持物、位置、所有权、损坏状态等当前可证事实；变化必须能接入既有状态时间线。
- `assignedBeats`：完成切拍后回填的 beat 索引；每个 `visible / flashback_visible` 实体至少有一个落点，其他 presence 默认不得作为画面主体绑定。
- `assetBinding`：若有真实项目资产，记录精确 node/asset 身份与职责；没有真实资产就明确缺失，不编造 ID、不按名称模糊匹配。

## Presence 判定

- `visible`：来源或已确认上下文明确要求其在当前物理画面中可见，包括身体局部、影子、倒影，只要身份可被画面承载。
- `audible_only`：声音存在但主体不在画内。只能进入发声/声音合同，除非后文另有可见证据。
- `mentioned_only`：被对白、旁白、文字或思想提及，但没有在场证据。不能因此绑定角色卡或塞进合照。
- `flashback_visible`：以回忆、屏幕、照片、投影、梦境等嵌套载体真实可见。必须同时记录载体与嵌套空间，不能把其场景/动作资产升级为当前物理空间。
- `unresolved`：指代、身份或在场性确实无法由当前一手事实确定。先回读相邻来源、上一章退出态、真实资产与工具结果；仍无法确定时显式保留证据不足，不能默认主角、默认 voice-over 或默认全部引用。

## 归并与状态规则

1. 同一身份的别名、代词、职业称谓、形态状态和 IP-safe 代称先归并，再切拍；状态变化进入 `stateTransitions / visualStateTimeline`，不能裂成两个角色。
2. 同名但证据不足以证明同一身份时不得合并；建立两个临时键并保留差异证据。
3. 群体与个体分开：群体在场不自动证明某个具名个体在场；具名个体有独立台词、行动或特写义务时不能只用群体条目代替。
4. 场景、道具、载具、界面同样受在场性约束。上一拍出现过或项目里已有资产，都不是本拍自动复用的依据。
5. 每次状态改变必须从上一已知状态承接。无法证明 before 值时标记未知边界，不用“默认完好、默认持有、默认同一服装”填空。

## 映射到现有合同

- 来源身份与在场事实 → `pacingDecision.essentialCausality + causalProvenance`。
- 跨拍位置、持物、服装、伤势、形态、所有权变化 → `dramaticChange.stateTransitions` 与 `visualStateTimeline`。
- 可复用对象与原图身份 → 根级 `objectRegistry`；逐拍全部入画对象 → `objectStates`。宿主从两者编译 `assetObjectContracts`，作者不直接填写派生合同。逐段从 storyEvents、首末关键帧和实际同框关系核对全体对象，不能只检查章级清单是否出现过一次；没有真实 ID 时记录需求，不伪造绑定。
- `objectStates` 的成员表示本拍可见范围，不是状态变化的筛选结果。没有动作、没有台词或状态不变的可辨认对象也必须列入；对话双方、递交双方、同看屏幕的人分别保留身份。仅画外发声不强行加入画面。
- 每拍真实可见主体 → 对应 storyboard / story-preview 的精确主体引用；服务端只做 ID、类型与范围校验，不从文案推断。
- `audible_only` 发声 → `speechLedger / dialogueScript.delivery=off_screen`；`mentioned_only` 不获得视觉绑定。

## 提交前自检

1. 每个来源中真实可见的实体是否都有稳定键、证据和至少一个 beat 落点？
2. 每个逐拍视觉主体能否反查到清单中的 `visible / flashback_visible` 条目？
3. 是否把对白中的人名、屏幕里的 Boss、照片人物、上一场景资产或“主角通常在场”当作当前画面证据？
4. 同一实体是否因别名、形态或状态版被裂成两份；两个不同实体是否仅因同名被误合并？
5. 关键状态是否按来源顺序承接，还是切拍后被无证据重置？

任一问题不通过，回到当前 agent 链继续阅读与修订；不得把内部纠偏变成 Hono 语义门禁或要求用户重试。
