import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
  normalizeShotTableTextReviewContract,
  parseShotTableText,
  type ShotTableTextReviewContract,
} from "@tapcanvas/shot-table-protocol";
import {
  readNewApiRelay,
  relayCriticChat,
  type CriticApiStyle,
} from "../agents/agents-llm-proxy";
import { resolveModelOutputBudget } from "../model-catalog/model-runtime-limits";
import { gateAndRenderStructuredClips } from "./video-orchestrator.shots-gate";
import type { FilmBible } from "./video-orchestrator.clip-shots";
import {
  parseVideoGenerationContract,
  type VideoGenerationContract,
} from "./video-orchestrator.generation-contract";
import {
  evaluateShotTableCriticWithSelfHealing,
  type ShotTableCriticAttemptDiagnostic,
  type ShotTableCriticExecutionIdentity,
} from "./shot-table-critic-self-healing";
import {
  type ShotTableCriticDimensionMap,
  type ShotTableCriticModelVerdict,
} from "./shot-table-critic-output";

export {
  normalizeShotTableCriticVerdict,
  SHOT_TABLE_CRITIC_DIMENSIONS,
} from "./shot-table-critic-output";

// 镜头表 critic 只有一条执行路径：精确继承主代理本轮 model + apiStyle，不接受参数
// 覆盖、不切备用模型。结构解析/截断/上游失败时，在同一模型内做一次有诊断事实的
// 有界自愈；第二次仍失败即显式终止，避免盲重试风暴。
const PASS_SCORE = 80;
export const SHOT_TABLE_CRITIC_MAX_TOKENS = 4_096;
const CHAT_TIMEOUT_MS = 180_000;

// rubric 维度内嵌（浓缩自 references/镜头语言规则.md），不在运行时跨 mount 读文件。export 仅供单测断言维度存在。
export const RUBRIC = `你是独立的资深实拍电影导演兼分镜审查官，对一张最终「拆镜镜头表」做通用事实审查。只核对输入合同、结构、连续性、可读性、内部因果和真实模型能力，不在 Hono 中按题材加载或固化战斗、技能、变身、动作奇观等创作方法，也不得因为作品没有采用某套固定招式、镜头或特效套餐而扣分；专业创作方法由 authoring agents、已加载 skills 与其语义证明负责。时长唯一依据是用户消息里的 generationContract：每条 clip 与 shots 加总必须相等并精确命中 durationOptions，禁止写死模型上限。逐条核查以下维度：
1. 调度/站位（dims.blocking）：只有最终镜头事实包含复杂多主体调度、明确空间连续性义务或已经声明 blocking 时，才审人物位置、朝向、距离、进出画和场景锚点是否自洽；不依赖站位的镜头缺少 blocking 判 ok，不按题材关键词决定。
2. 轴线与视线：镜头已建立人物关系、运动方向或视线关系时，检查 180° 轴线、视线匹配与出入画方向是否自洽；越轴必须由可见转身、镜头重建空间或明确切换解释。双人同框不得出现人物同时面对对方又正面朝镜头的几何矛盾；topFixes 只能根据当前真实构图给出可执行调整，不套固定题材模板。
3. 景别/焦段/机位角度（dims.focalAngle·锦上添花，非必填）：**默认按秒把画面讲清楚的轻量片，不写景别/焦段完全允许——缺失一律判 ok，绝不判 missing、绝不因"没写景别"扣分**；仅当本镜**已写了**景别/焦段时才审它有无心理理由（写了却毫无动机=weak）。对话戏若已用镜头，OTS 正反打优于"默认跟随特写"。
4. 构图+景深破贴片：交付权力关系（位置/视线空间/留白用途/前中后景层次）；浅景深 + 明确前景遮挡破 AI 贴片感。
5. 运镜（dims.movement·锦上添花，非必填）：不写运镜完全允许，缺失判 ok；写了运镜才审它是否服务当前主体变化、信息揭示或连续性，装饰性运镜判 weak。不得根据题材要求额外运镜、多镜、速度重音或固定镜头套餐。
6. 节奏重音不千篇一律：重音分布而非均匀节拍；高潮不应全是"特写+缓推+长保持"，可静止远景/切黑/反应留白/声音抽空。
7. 时间处理（dims.slowMo）：仅检查镜头表是否把生成阶段无法精确保证的帧级剪辑结果伪装成已经可确定执行的事实；是否采用慢动作、凝滞或速度变化属于 authoring agents 的语义决定，critic 不设题材次数、固定位置或收尾模板。
8. 声音设计（dims.sound）：环境音/对白密度/静默用法/J-cut·L-cut/动机声/音乐重音。**对白覆盖硬判（叙事改编最常踩，ch38 实测）：若提供了原文脚本且原文含引号对白，逐句核对每句对白是否用 spoken-dialogue 语法（角色（情绪）：「台词」）保留进了对应镜的提示词——只要有原文对白被丢弃/改写成纯动作描述/缩写，sound 一律判 missing（不是 weak），并在 issues 标"声音缺失：对白未保留"。纯空镜/B-roll/无对白段不在此限。**
9. 表演行为链：可拍的连续微表演链（犹豫→视线逃避→呼吸停顿→身体后撤→手指收紧），而非静态情绪词。
10. 镜长与切点服务认知：长镜或切镜都必须由戏剧目的决定。判断、误判、承诺动作、结果与恢复需要可读时长；不能为了填满 generationContract 的某个合法档位而塞节拍，也不能按固定1~2秒把动作切成游戏播报。切点应发生在信息、权力、视点或运动方向真正改变处；连续动作跨 clip 必须在本 clip 内完成一个可读因果单元。跨镜短段若没有独立变化终点→weak/missing；单条内逐秒描述本身不扣分，但事件过载按 signalPurity 判。
11. 一镜一主信息：每个镜头只交付一个主信息，不要塞满。
12. 主体动作幅度 + 三层动作（治 PPT 感与木偶感）：每镜必须有至少一个有幅度的物理动作动词（起身/碾碎/抽被褥/推窗），禁全镜只有"垂眼/微笑/眼神变化"级微表情配 VO；说话镜身体要参与表演（转头/抬手/前倾），不许只动嘴；连续多镜"人物坐定+只有特效在动"判 missing。**三层动作要求**：叙事/情感镜的"画面内容/人物动作"应写到【身体动作 + 跟随动作 + 细微反应（咬唇/垂眸/喉结滚动/指尖泛白/攥衣角）】——只写身体动作、缺细微反应层 = 木偶感，判 weak（写进 issues 前缀"表演："）。
13. 分段剧本因果与时空连贯（治"对话不自洽/时空过载"，ch3 实测）：若提供了原文脚本，核对——①相邻镜台词/事件顺序与原文因果链一致，禁结论先于原因（如先说"净身出户"结论、后揭"对方回来了"原因即为倒置）；②单镜不横跨多个叙事时间段（睡着→两天后→第三天压进一镜=过场突兀），跳日/隔夜应单独成镜或用转场镜承接；③单镜对话密度不过载（不超过 2~3 个来回）；④若镜头表带 exitState（每镜退出态）：逐对比对第 N 镜 exitState 与第 N+1 镜 continuity/开场动作是否呼应——人物位置/姿态/手中道具/伤况/光线矛盾（上镜已起身拔剑、下镜开场又端坐空手）即为承接断裂；缺 exitState 的相邻对退化为读 action 收尾推断，不因缺字段判罚；⑤人物存续：前一镜在场的角色，下一镜（非特写/未换场景）画面里既不在场、也无去向交代（明确离场动作/切为特写/场景切换 三选一）=凭空消失，反之凭空出现同罪；反打镜按实拍范围豁免（拍不到的不必复述）；⑥换场引导（2026-07-13 ch24 地面→海底瞬移实证）：相邻镜地点/场景切换（含「与此同时」平行剪辑）时，后镜**第一个可渲染 shot** 须有换场引导——establishing 大全景 / 镜头位移动作（下潜·升起·推进）/ VO「与此同时…」三选一；引导只写在承接注释/时空头而首拍直接切主体特写＝观众瞬移感，同样算缺。**本维度的问题写进 issues（前缀"剧本因果："），不新增 dims 项**。
14. 主体运动与编排合理性（dims.subjectMotion）：根据镜头已经声明的主体、环境和因果义务，检查可见状态变化是否足以承载本镜主事件；多主体交互时，各主体的反应必须与前序刺激和最终状态相容。只有相机或特效变化而主体状态没有变化，或出现无来源位移、持物跳变、时机倒置与空间不可达，判 weak/missing。不得按题材补充本镜未声明的动作类型、攻防套路或环境效果。
15. 运动起终态锚与可选首尾帧（dims.keyframe）：先看本任务是否真实提供 storyboardImageNodeId / lastFrameImageNodeId / firstFrameUrl / lastFrameUrl 等帧资产。**没有帧资产本身不扣分，也不得要求临时补分镜板**——整章 commit_beats 主路径允许只用角色/场景/道具参考图 + 文字时间轴。无帧模式改审文字是否同时钉住：①动作开始前谁在何处、姿态/持物/运动方向；②结束时谁到何处、控制权/重心/持物如何变化；③中间因果物理可达。起势和终态都清楚→ok；只清楚一端→weak；两端都含糊、让模型自行决定关键空间结果→missing。只有任务真实携带首/尾帧时，才审帧与文字、角色卡和场景拓扑是否一致，互相冲突→missing。纯氛围/空镜/定场静止镜判 ok。topFixes 只能要求补**文字起终态锚**或修正已有帧绑定，禁止把新增外部图片资产当成镜头表 writer 可执行的修订项。
16. 视觉来源与影调一致（dims.look）：先判断静态 look 由什么承担。已有画风锚/角色卡/场景卡时，提示词只需写本镜新增的光线变化与运动，重复长篇外观、器材和数值反而稀释动作信号；没有视觉参考时才需要足够明确的媒介、色彩、光源方向和层次。不同来源互相冲突→missing；只有“电影感/高级感”等空词且无参考→weak；信息简洁但来源明确、无冲突→ok。不得因缺 IRE、摄影机品牌、固定数值段扣分。
17. 信号纯度与容量（dims.structure）：不设置字符上限或下限作为质量评分规则。检查是否围绕一个 primary dramatic change，优先级是否为“不可删因果→连续性锁→可选纹理”；参考图已承担的静态信息不得反复复述，整章情绪弧/人物弧不得原样塞进每条视频提示词，禁止结尾重复一遍参考映射。多个同权主事件、或主因果被大段 look/禁令/术语淹没→missing；有少量重复但主线仍清楚→weak；短而完整同样可判 ok，较长但因果完整也可判 ok。真实供应商字符边界只由提交层事实校验，不在 critic 中判 missing。



22. 情境合理性·穿帮实体（dims.plausibility；治「手术室桌上摆干枯解剖头骨」类一眼假·2026-07-04 实证）：逐镜审「画面内容里的专业/精密实体，视频模型直给渲染会不会画成情境错误的通用样子」——高危实体：术中人体组织与器官（头骨/骨瓣/脏器）、精密操作（手术/拆弹/仪器读数）、画面文字、复杂机械结构、专业规程场景（无菌区/实验室）。凡此类实体被**直给**写进画面（如「取下头骨盖回去」直接拍头骨）而未用视听替代（①只拍操作者反应特写 ②前景遮挡关键部位 ③操作对象 POV 视点反拍 ④可控局部特写如一条切口）→ plausibility 判 weak；整镜叙事依赖该实体正确渲染（特写它/它是主体）→ 判 missing。无高危实体的镜判 ok。把问题写进 issues（前缀「穿帮：」，点名镜号与实体）+ topFixes 给替代拍法。**同维另审「拍间状态链」（2026-07-10 ch10「站着→下一秒趴地」实证）**：同一 clip 内相邻拍的主体姿态/位置/持物若发生**无过渡跳变**（站→倒、A 点瞬移 B 点、持物凭空消失，且上一拍末或本拍开头没写因果过渡动作）→ plausibility 判 weak；跳变发生在该 clip 的叙事主拍（观众必看清的动作）→ 判 missing。issues 前缀「状态跳变：」点名镜号与断点，topFixes 给过渡动作写法。

23. 表演活人感（dims.aliveness；治「叙事对了但角色是木偶」·2026-07-04 用户定调「灵魂在演员的情绪与行为」）：逐镜审 action 第三层与 dialogue 情绪标注——①**禁标签词**：出现「表情凝重/内心慌乱/眼神复杂/十分愤怒」这类不可拍摄的情绪标签而无生理证据（呼吸变化/失控小部位/视线行为，如「喉结滚动后别开视线」「端杯的手微颤」）→ 判 weak；②**情绪连续性**：相邻镜情绪状态跳变（上镜结尾强忍、下镜开头平静）且画面内无触发事件 → 判 weak；③**群像木桩**：多人镜里无台词角色没有任何反应落点（眼神/身体微调）→ 判 weak；④大情绪一步到位（直接嚎哭/暴怒，无「抑制→裂缝→释放」的构造）且全片普遍 → 判 missing。全片表演层普遍只有身体动作没有微反应层 → 判 missing。把问题写进 issues（前缀「表演：」，点名镜号）+ topFixes 给具体生理反应写法。

24. sd2 适配度（dims.sd2Fit；治「用实拍电影语法写 sd2 提示词导致穿模/对白不可用/密度废片」·2026-07-08 内化 seedance-2.0 方法论）——三子判，取最严档：
① 对口型可行性：任一角色在**背对镜头/转头/大幅动作/极端运镜**时说台词（需对口型）→ 物理上不可对口型，判 **missing**；或声明了「人声对白」却无任何「」台词行 → 判 **missing**。台词镜用锁定/微动机位+正脸+短句 → ok。
② 密度实质超载：单条 clip 硬塞多地点、多个完整叙事动作、多轮战术交换，或让关键判断/反应没有可读时间→missing。逐秒时间轴不自动扣分，也不自动豁免；判断依据是一个主要变化终点能否被观众读懂。
③ 动画语法（仅 2D/三渲二/anime/cel 题材）：用了 zoom-in/motion blur/screen shake/景深/handheld 等实拍机身词 → 判 **weak**（不硬拦），应改 sakuga/impact frame/smear/cel shadow。实拍/写实题材不在此限，判 ok。
**仅将①②标记为 missing 诊断**；③及一切轻度不足只 weak。纯文字 logline 阶段判 ok。缺口写进 issues（前缀「sd2：」）+ topFixes；诊断不取得生成/提交终止权。
25. IP/版权指纹（dims.ipSafety；治「成片撞知名 IP 被上游输出侧版权审核整镜拒收」·2026-07-10 怪兽片实测：发光背脊+口吐能量束+城市毁灭=哥斯拉指纹，成片渲染完被 OutputVideoSensitiveContentDetected copyright 打回、整发渲染费白烧）——两子判：
① **真人姓名**：提示词任何字段（含导演基调/风格描述）出现**在世或知名真人**（导演/演员/明星/运动员）姓名 → 判 **missing**（写手法不写人名：「巨物尺度压迫+体积光神性显形」可以，「迈克尔·贝式」不行）。
② **知名形象指纹组合**：原创角色/怪兽/机甲/英雄的设计描述是否复现了某知名 IP 的**标志性特征组合**（如 哥斯拉=发光背脊+口吐能量束+巨型爬行类；奥特曼=银红配色巨人+胸口计时器；EVA=紫绿装甲人形+插入栓）——单一特征无妨，**≥2 个标志性特征同时命中**即判 **weak** 并在 issues 点名撞了哪个 IP、给出「破坏组合」的改法（换发光部位/换攻击形态/换配色剪影）；描述里直接点名 IP/作品名（「像哥斯拉一样」）→ 判 **missing**。有版权授权声明或复刻类任务（视频复刻替换域）不在此限判 ok。缺口写进 issues（前缀「IP：」）+ topFixes。

26. 盲观众传达三问（dims.blindComprehension；治「信息在提示词里、观众看不懂」——覆盖≠传达·2026-07-13 ch23 骨片暗线/ch24 揭晓弱定调）：切换视角——假设你**没读过原文**、只凭这张镜头表的画面与台词/VO 看片，回答三问：①【为什么】主角每个关键行动的动机，画面或台词交代了吗（动机只写在 logline/注释=观众看不到）？②【哪来的】每个反转/新事物（新人物·新法宝·身份揭晓·新能力）出现时，有没有「亮相/点破」拍（台词/VO/特写至少一个通道显性给出来历）？③【想看下一章吗】结尾钩子是不是画面级的（悬念意象/威胁/未解之问入画），而非任务式收尾或旁白硬总结？任一问某镜答不出 → blindComprehension 判 weak；主线因果链必须靠读过原文才能连上 → 判 missing。issues 前缀「盲观众：」点名镜号与看不懂处，topFixes 给显性化拍法（VO 一句/特写一拍/借旁人之口）。

27. 角色因果（dims.characterCausality）：关键行动是否能读出“目标/赌注→有限感知→判断或误判→选择→后果→下一策略变化”。只写情绪和动作、看不出为什么此刻这样做→missing；链条可推断但判断或代价未显形→weak；生理反应必须改变行动时机，而不是动作外附加表情。
28. 导演组织（dims.directingCoherence）：每条 clip 是否只有一个主要戏剧变化，调度、镜头、表演和声音是否共同服务它。摄影术语多但互不协作、三段重复同一“差点成功→被打断→转移控制”波形→weak；没有主变化或镜头目的彼此冲突→missing。
29. 主观视点（dims.subjectivePOV）：明确观众此刻跟谁一起看、一起误判，或为何暂时回到客观空间。全程只追物体/奇观导致人物无感知归属，且没有角色反应节点→missing；视点偶有漂移但仍能跟住决定→weak。主观不等于必须脸部特写，可由遮挡、焦点、呼吸、声场和反应顺序建立。
30. 知识与权力变化（dims.powerKnowledgeShift）：核对 audienceKnowledge/characterKnowledge/revealOrder 与 powerBefore→powerAfter 是否在画面中兑现。观众先知道、角色后知道，或角色误信而观众看见破绽，都是有效戏剧；若所谓“误判/翻盘”没有先展示感知和承诺动作，只在结果后说明→missing。
32. 容量与可读性（dims.signalPurity）：按该 clip 在 generationContract 中选定的真实成片时长审事件容量，不按提示词长短奖励。关键判断、反应、后果都必须有可读时间；单条内塞多个完整交换、多个地点或二十余状态变化，导致只能机械执行清单→missing。能删 optional texture 或合并同因果动作后读清→weak；主要变化、因果、连续性锁有清楚优先级→ok。

评分：**总分与 pass 由系统按 dims 确定性推导**（每 missing −8、每 weak −3，从 100 起扣；≥${PASS_SCORE} 且无任何 missing 才 pass）——你 JSON 里的 score/pass 只是兼容字段，不参与最终判定。你的评审重心＝把每一维的 ok/weak/missing 判准、issues 点名镜号、topFixes 可直接执行。**dims 每一项都只能填 ok / weak / missing 三者之一，不要写任何解释**（解释一律放进 issues）。
硬性输出要求：**只输出下面这一个紧凑 JSON，单行、无 markdown、无任何解释或前后缀文字**，否则会被截断作废。affectedClipIndexes 必须列出 issues/topFixes 实际涉及的 0-based 全局 clipIndex；pass=false 时至少一个，禁止用镜头表显示序号或局部数组下标代替：
{"pass":true,"score":85,"dims":{"blocking":"ok|weak|missing","axis":"ok|weak|missing","focalAngle":"ok|weak|missing","compositionDoF":"ok|weak|missing","movement":"ok|weak|missing","rhythm":"ok|weak|missing","slowMo":"ok|weak|missing","sound":"ok|weak|missing","tailFrame":"ok|weak|missing","infoDensity":"ok|weak|missing","subjectMotion":"ok|weak|missing","keyframe":"ok|weak|missing","look":"ok|weak|missing","structure":"ok|weak|missing","plausibility":"ok|weak|missing","aliveness":"ok|weak|missing","sd2Fit":"ok|weak|missing","ipSafety":"ok|weak|missing","blindComprehension":"ok|weak|missing","characterCausality":"ok|weak|missing","directingCoherence":"ok|weak|missing","subjectivePOV":"ok|weak|missing","powerKnowledgeShift":"ok|weak|missing","signalPurity":"ok|weak|missing"},"issues":["≤5条简短问题"],"topFixes":["≤3条可直接执行的修正"],"affectedClipIndexes":[0]}`;

const TEXT_STORYBOARD_RUBRIC = `${RUBRIC}

<text_storyboard_mode_override>
本次评审对象是最终文本分镜表，不是出片 clips。本区覆盖上文所有仅适用于 video_clips 的要求：
- 不要求 generationContract、filmBible、adaptationStrategy、shots JSON、图片资产或视频审批 token；这些缺失不得扣分，对应不适用维度判 ok。
- sourceMaterial 若提供，它是剧情、对白顺序、既有镜头边界、时间码与可见可听事实的唯一真相；禁止用导演性补充改写来源事实。若未提供，只审分镜表本身，不得臆测忠实度缺陷。
- reviewContract 若提供，逐项核对列合同、来源锁、15 秒节拍、3 秒内时序切换、台词容量、无音乐与无字幕。合同值优先于上文的常规视频时长建议。
- 重点审自然主义表演、所有出镜人物的可见反应、以场景参照物表达的站位/朝向/距离/视线、跨节拍状态与光线连续性、动作可拍性、机位变化功能、对白/OS 声画关系及衔接。
- affectedClipIndexes 在本模式表示 0-based 镜头顺序；pass=false 时至少给出一个实际受影响的镜头序号。最终仍必须输出完整 25 维 JSON 合同。
</text_storyboard_mode_override>`;

type PerModelResult = {
  model: string;
  apiStyle: CriticApiStyle;
  score: number;
  pass: boolean;
};

export type ShotTableCriticResult = {
  pass: boolean;
  overallScore: number;
  issues: string[];
  topFixes: string[];
  /**
   * 0-based clip indexes explicitly identified by the semantic critic.
   * A failed verdict without this evidence cannot be converted into a scoped rewrite.
   */
  affectedClipIndexes: number[];
  /** true means the deterministic structure gate rejected the draft and no LLM critic call was made. */
  preflightFailed?: boolean;
  perModel: PerModelResult[];
  /**
   * 跨模型「最差档合并」的逐维评级（missing>weak>ok 取最严）。
   * 仅作为可选的可审计诊断证据，不阻断生成、提交、持久化或交付。
   */
  mergedDims: ShotTableCriticDimensionMap;
  /** 可审计的同模型自愈事实；不包含模型原始输出。 */
  selfHealing?: {
    inheritedExecution: { model: string; apiStyle: CriticApiStyle };
    attemptsUsed: 1 | 2;
    repaired: boolean;
    diagnostics: ShotTableCriticAttemptDiagnostic[];
  };
};

type CriticPreflightResult =
  | { ok: true; shotTable: string; clipIndexes: number[]; warnings: string[] }
  | { ok: false; result: ShotTableCriticResult };

function readClipIndex(clip: unknown): number | null {
  if (!clip || typeof clip !== "object" || Array.isArray(clip)) return null;
  const value = Number((clip as Record<string, unknown>).clipIndex);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function preflightShotTableCritic(input: {
  clips: readonly unknown[];
  filmBible: FilmBible | null;
  generationContract: unknown;
}): CriticPreflightResult {
  const generationContract = parseVideoGenerationContract(input.generationContract);
  if (!generationContract) {
    throw new AppError("critic generationContract 无效或缺失", {
      status: 400,
      code: "critic_generation_contract_invalid",
    });
  }
  const clips = structuredClone(input.clips) as unknown[];
  const parsedClipIndexes = clips.map(readClipIndex);
  if (parsedClipIndexes.some((clipIndex) => clipIndex === null)) {
    throw new AppError("critic 每条 clips[].clipIndex 都必须显式提供非负整数，禁止按数组下标回退", {
      status: 400,
      code: "critic_clip_indexes_invalid",
    });
  }
  const clipIndexes = parsedClipIndexes as number[];
  if (new Set(clipIndexes).size !== clipIndexes.length) {
    throw new AppError("critic clips.clipIndex 必须唯一", {
      status: 400,
      code: "critic_clip_indexes_invalid",
    });
  }
  const detail = gateAndRenderStructuredClips({
    clips,
    bible: input.filmBible,
    slotNos: clipIndexes,
    maxDurationSec: generationContract.maxDurationSeconds,
    durationOptions: generationContract.durationOptions,
  });
  const rejectedByIndex = new Map<number, string[]>();
  for (const globalNo of detail.missingShots) {
    rejectedByIndex.set(globalNo - 1, ["缺少结构化 shots"]);
  }
  for (const rejection of detail.rejected) {
    rejectedByIndex.set(rejection.globalNo - 1, rejection.problems);
  }
  if (rejectedByIndex.size > 0) {
    const affectedClipIndexes = Array.from(rejectedByIndex.keys()).sort((a, b) => a - b);
    const issues = affectedClipIndexes.map(
      (clipIndex) => `clipIndex=${clipIndex} 结构门禁未通过：${(rejectedByIndex.get(clipIndex) ?? []).join("；")}`,
    );
    return {
      ok: false,
      result: {
        pass: false,
        overallScore: deriveScoreFromDims({ structure: "missing" }),
        issues: issues.slice(0, 10),
        topFixes: issues.slice(0, 6),
        affectedClipIndexes,
        preflightFailed: true,
        perModel: [],
        mergedDims: { structure: "missing" },
      },
    };
  }
  const shotTable = clips
    .map((clip, localIndex) => {
      const record = clip as Record<string, unknown>;
      const clipIndex = clipIndexes[localIndex];
      const duration = Number(record.durationSeconds);
      const roles = Array.isArray(record.characterRoleNames)
        ? record.characterRoleNames.map((role) => String(role ?? "").trim()).filter(Boolean).join("、")
        : "";
      return (
        `【clipIndex=${clipIndex}｜${Number.isFinite(duration) ? `${duration}s` : "时长未定"}${roles ? `｜${roles}` : ""}】\n` +
        String(record.clipPrompt ?? "")
      );
    })
    .join("\n\n");
  return { ok: true, shotTable, clipIndexes, warnings: detail.warnings };
}

type TextStoryboardCriticPreflightResult =
  | {
      ok: true;
      shotTable: string;
      reviewContract: ShotTableTextReviewContract | null;
      shotIndexes: number[] | null;
    }
  | { ok: false; result: ShotTableCriticResult };

export function preflightTextStoryboardCritic(input: {
  shotTable: string;
  reviewContract?: unknown;
}): TextStoryboardCriticPreflightResult {
  const shotTable = input.shotTable.trim();
  if (!shotTable) {
    throw new AppError("text_storyboard critic 的 shotTable 不能为空", {
      status: 400,
      code: "shot_critic_text_storyboard_required",
    });
  }
  if (typeof input.reviewContract === "undefined") {
    return { ok: true, shotTable, reviewContract: null, shotIndexes: null };
  }

  const normalizedContract = normalizeShotTableTextReviewContract(input.reviewContract);
  if (!normalizedContract.ok) {
    throw new AppError(`text_storyboard reviewContract 无效：${normalizedContract.issues.join("；")}`, {
      status: 400,
      code: "shot_critic_text_review_contract_invalid",
      details: { issues: normalizedContract.issues },
    });
  }
  const parsed = parseShotTableText(shotTable, {
    expectedColumns: normalizedContract.contract.columns,
  });
  if (!parsed.ok) {
    const issues = parsed.issues.map((issue) => `文本分镜表结构未通过：${issue}`);
    return {
      ok: false,
      result: {
        pass: false,
        overallScore: deriveScoreFromDims({ structure: "missing" }),
        issues: issues.slice(0, 10),
        topFixes: issues.slice(0, 6),
        affectedClipIndexes: [],
        preflightFailed: true,
        perModel: [],
        mergedDims: { structure: "missing" },
      },
    };
  }
  const shotIds = Array.from(new Set(parsed.table.rows.map((row) => row.shotId)));
  return {
    ok: true,
    shotTable,
    reviewContract: normalizedContract.contract,
    shotIndexes: shotIds.map((_, index) => index),
  };
}

/**
 * 从 dims 确定性推导总分（2026-07-10 用户拍板·去 LLM 自报分锚定效应）：
 * 100 起步，每个 missing −8、每个 weak −3，钳到 [0,100]。此前 LLM 自报 0-100 且 RUBRIC
 * 明示「≥80 才 pass」——阈值成了分数磁铁，分数恒聚 80+ 无信息量；改为推导后分数=缺陷的
 * 确定性函数，golden-shots 95 入库线相应重标定为「零 missing 且至多 1 个 weak」。
 */
export function deriveScoreFromDims(dims: ShotTableCriticDimensionMap): number {
  let score = 100;
  for (const v of Object.values(dims)) {
    if (v === "missing") score -= 8;
    else if (v === "weak") score -= 3;
  }
  return Math.max(0, Math.min(100, score));
}

/** 跨模型最差档合并：每个维度取所有有效模型里最严的评级（missing > weak > ok）。 */
export function mergeDimsWorst(
  dimsList: ShotTableCriticDimensionMap[],
): ShotTableCriticDimensionMap {
  const rank: Record<string, number> = { ok: 0, weak: 1, missing: 2 };
  const out: ShotTableCriticDimensionMap = {};
  for (const dims of dimsList) {
    for (const [k, v] of Object.entries(dims)) {
      if (!(v in rank)) continue;
      if (!(k in out) || rank[v]! > rank[out[k]!]!) out[k] = v;
    }
  }
  return out;
}

async function chatRaw(
  c: AppContext,
  input: {
    model: string;
    apiStyle: CriticApiStyle;
    system: string;
    user: string;
    phase: "evaluation" | "same_model_structure_repair";
  },
): Promise<string> {
  const relay = readNewApiRelay(c);
  if (!relay) throw new Error("new-api relay not configured");
  const outputBudget = await resolveModelOutputBudget({
    c,
    modelKey: input.model,
    desiredMaxOutput: SHOT_TABLE_CRITIC_MAX_TOKENS,
    inputText: `${input.system}\n${input.user}`,
  });
  return relayCriticChat(relay, {
    model: input.model,
    apiStyle: input.apiStyle,
    system: input.system,
    user: input.user,
    temperature: input.phase === "evaluation" ? 0.2 : 0,
    maxTokens: outputBudget.effectiveMaxOutput,
    timeoutMs: CHAT_TIMEOUT_MS,
    responseFormat: { type: "json_object" },
  });
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 组装 critic 用户消息（导出供单测）：brief + 同一真实 generationContract + 待审镜头表。
 */
export function buildCriticUserMessage(input: {
  shotTable: string;
  generationContract: VideoGenerationContract;
  brief?: string;
}): string {
  const briefLine = input.brief?.trim() ? `题材/风格简述：${input.brief.trim()}\n\n` : "";
  const generationContractLine =
    `本次评审与实际生成共用且不可变的 generationContract：${JSON.stringify(input.generationContract)}。` +
    `每条 clip.durationSeconds 与 shots 加总必须相等并精确命中 durationOptions，不得按固定 15 秒或只按最大值评审。\n\n`;
  return `${briefLine}${generationContractLine}待审镜头表：\n${input.shotTable}`;
}

export function buildTextStoryboardCriticUserMessage(input: {
  shotTable: string;
  sourceMaterial?: string;
  reviewContract?: ShotTableTextReviewContract | null;
  brief?: string;
}): string {
  const briefLine = input.brief?.trim()
    ? `题材/风格简述：${input.brief.trim()}\n\n`
    : "";
  const contractLine = input.reviewContract
    ? `本次文本分镜硬合同：${JSON.stringify(input.reviewContract)}\n\n`
    : "本次未提供额外文本分镜硬合同；只按 rubric 审核，不得自行补造合同。\n\n";
  const source = input.sourceMaterial?.trim();
  const sourceLine = source
    ? `来源材料（忠实度真相源）：\n${source}\n\n`
    : "本次未提供来源材料；不得对剧情或对白忠实度作无证据扣分。\n\n";
  return `${briefLine}${contractLine}${sourceLine}待审最终文本分镜表：\n${input.shotTable}`;
}

function logCriticDiagnostic(diagnostic: ShotTableCriticAttemptDiagnostic): void {
  console.error(
    `[shot-table-critic] ${JSON.stringify({
      event: "same_model_self_heal_attempt_failed",
      ...diagnostic,
    })}`,
  );
}

function resolveCriticExecution(input: {
  criticModel: string;
  criticApiStyle: CriticApiStyle;
}): ShotTableCriticExecutionIdentity {
  const criticModel = input.criticModel.trim();
  if (!criticModel) {
    throw new AppError("criticModel 缺失：critic 必须显式继承调用方本轮实际模型", {
      status: 500,
      code: "agents_tool_shot_critic_failed",
    });
  }
  if (input.criticApiStyle !== "chat" && input.criticApiStyle !== "responses") {
    throw new AppError("criticApiStyle 缺失或非法：critic 必须精确继承调用方本轮协议", {
      status: 500,
      code: "agents_tool_shot_critic_failed",
    });
  }
  return { model: criticModel, apiStyle: input.criticApiStyle };
}

async function runSemanticCritic(
  c: AppContext,
  input: {
    rubric: string;
    userMessage: string;
    execution: ShotTableCriticExecutionIdentity;
    allowedIndexes: ReadonlySet<number> | null;
  },
): Promise<ShotTableCriticResult> {
  if (!readNewApiRelay(c)) {
    throw new AppError("new-api relay 未配置，无法运行镜头表 critic", {
      status: 500,
      code: "agents_tool_shot_critic_failed",
    });
  }

  const evaluation = await evaluateShotTableCriticWithSelfHealing({
    rubric: input.rubric,
    userMessage: input.userMessage,
    execution: input.execution,
    invoke: (invocation) => chatRaw(c, invocation),
    onDiagnostic: logCriticDiagnostic,
  });
  if (!evaluation.verdict) {
    const lastDiagnostic = evaluation.diagnostics.at(-1);
    throw new AppError("镜头表 critic 同模型自愈已耗尽（解析/结构/上游错误仍未恢复）", {
      status: 502,
      code: "agents_tool_shot_critic_failed",
      details: {
        failureReason: "same_model_critic_self_heal_exhausted",
        rationale: "已在精确继承的 model + apiStyle 内完成一次结构化自愈，未切换模型或协议。",
        missingCriteria: lastDiagnostic?.missingCriteria ?? ["valid_critic_verdict"],
        requiredActions: [
          "保留本次失败诊断并显式报告",
          "禁止切换模型、协议或备用专家模型",
          "禁止原样重复提交同一 critic 调用",
        ],
        inheritedExecution: input.execution,
        attemptsUsed: evaluation.attemptsUsed,
        automaticRetryAllowed: false,
        diagnostics: evaluation.diagnostics,
      },
    });
  }
  const verdict: ShotTableCriticModelVerdict = evaluation.verdict;

  // 总分不取模型自报分；由完整 dims 确定性推导。perModel 仅保留继承身份与原始自报分作审计。
  const mergedDims = mergeDimsWorst([verdict.dims]);
  const overallScore = deriveScoreFromDims(mergedDims);
  const pass =
    overallScore >= PASS_SCORE && !Object.values(mergedDims).includes("missing");
  const issues = dedupe(verdict.issues).slice(0, 10);
  const topFixes = dedupe(verdict.topFixes).slice(0, 6);
  const declaredAffectedClipIndexes = [...new Set(verdict.affectedClipIndexes)].sort(
    (left, right) => left - right,
  );
  const affectedClipIndexes = pass
    ? []
    : input.allowedIndexes
      ? declaredAffectedClipIndexes.filter((clipIndex) => input.allowedIndexes?.has(clipIndex))
      : declaredAffectedClipIndexes;

  const perModel: PerModelResult[] = [
    {
      model: input.execution.model,
      apiStyle: input.execution.apiStyle,
      score: verdict.score,
      pass: verdict.pass,
    },
  ];

  return {
    pass,
    overallScore,
    issues,
    topFixes,
    affectedClipIndexes,
    perModel,
    mergedDims,
    selfHealing: {
      inheritedExecution: input.execution,
      attemptsUsed: evaluation.attemptsUsed,
      repaired: evaluation.repaired,
      diagnostics: evaluation.diagnostics,
    },
  };
}

/**
 * 使用主代理本轮的精确 model + apiStyle 执行 video_clips critic。
 */
export async function critiqueShotTable(
  c: AppContext,
  input: {
    clips: readonly unknown[];
    filmBible: FilmBible | null;
    generationContract: VideoGenerationContract;
    criticModel: string;
    criticApiStyle: CriticApiStyle;
    brief?: string;
  },
): Promise<ShotTableCriticResult> {
  const execution = resolveCriticExecution(input);
  const preflight = preflightShotTableCritic(input);
  if (!preflight.ok) return preflight.result;
  const userMessage = buildCriticUserMessage({
    shotTable: preflight.shotTable,
    generationContract: input.generationContract,
    ...(input.brief ? { brief: input.brief } : {}),
  });
  return runSemanticCritic(c, {
    rubric: RUBRIC,
    userMessage,
    execution,
    allowedIndexes: new Set(preflight.clipIndexes),
  });
}

/**
 * 审核最终文本分镜表。该模式不铸视频审批 token，也不要求出片 generationContract。
 * Skill 要求只调用一次，主代理在同一回合应用 topFixes 后直接交付最终文本。
 */
export async function critiqueTextStoryboard(
  c: AppContext,
  input: {
    shotTable: string;
    sourceMaterial?: string;
    reviewContract?: unknown;
    criticModel: string;
    criticApiStyle: CriticApiStyle;
    brief?: string;
  },
): Promise<ShotTableCriticResult> {
  const execution = resolveCriticExecution(input);
  const preflight = preflightTextStoryboardCritic(input);
  if (!preflight.ok) return preflight.result;
  const userMessage = buildTextStoryboardCriticUserMessage({
    shotTable: preflight.shotTable,
    reviewContract: preflight.reviewContract,
    ...(input.sourceMaterial ? { sourceMaterial: input.sourceMaterial } : {}),
    ...(input.brief ? { brief: input.brief } : {}),
  });
  return runSemanticCritic(c, {
    rubric: TEXT_STORYBOARD_RUBRIC,
    userMessage,
    execution,
    allowedIndexes: preflight.shotIndexes ? new Set(preflight.shotIndexes) : null,
  });
}
