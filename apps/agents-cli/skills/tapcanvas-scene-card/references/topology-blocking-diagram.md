# 拓扑图与站位图：正交建筑剖切与动作调度

用户于 2026-09-14 指定的绘制范式。原文完整保存在 [奶茶店示例](topology-blocking-boba-reference.md)。本文件是场景 Skill 内的渐进披露知识，不是 Hono/Web 固定提示词或运行时语义检查。

**职责边界**：本文件只回答站位图**怎么画**——正交顶视、建筑剖切、双语标注、编译顺序、提示词骨架。站位与调度本身**怎么决定**（戏剧轴线、working side 继承、正反打配对、竖屏纵深、关系投影、控制权交接、机位与景别选择、交付面遮挡）属于 `tapcanvas-dramatic-adapter` 的 `references/blocking-staging-craft.md`。本文件不发明站位，也不重复其判断；绘制时的人物位置、朝向、轨迹与机位都是已决定的调度事实的呈现。

## 固定视觉要求

- 严格 90° 正交顶视、清晰建筑剖切平面；不得变成斜俯视、等距透视或室内效果图。
- 16:9 横幅，精细真实材质，清晰矢量式中英双语标注、人物与动作图例、导演机位及视锥。
- 有参考内景照片时按精确资产 ID 绑定，保持门窗、墙体、柜台、家具、固定设备、招牌和通道的真实相对位置，不镜像、不为美观重排。
- 影棚式清晰照明用于读图；保留有依据的灯带、发光招牌与材质响应。此项属于技术图呈现，不改变剧情场景的实际时间与灯光合同。
- 人物服装、位置、朝向、接近距离、动作发起点、轨迹、落点与机位服从当前剧情及已确认空间合同。方向箭头起止明确；冲击/飞溅符号只在有对应动作时出现。

## 编译顺序

1. 从当前场景证据写 Spatial Layout：按实际区域和固定地标说明空间，不把示例的西侧入口、L 型柜台或奶茶设备带入其他地点。
2. 从当前拍摄段落写 Character Positions & Tight Blocking：用稳定角色身份、角色相对地标的位置、朝向及有依据的距离冻结调度；人物服装引用当前身份/状态资产。
3. 分别写动作轨迹与导演机位：动作源、路径、目标及方向；每个真实机位的编号、位置、朝向和视锥，不把两台机位硬套给全部场景。
4. 应用固定顶视和 16:9 技术图呈现要求，保留可读地标与关键遮挡，不让标注覆盖主要空间关系。
5. 核对提示词、结构化坐标和构图合同描述的是同一场面；由 Agent 在当前创作链内修订，不增加质量闸门。

1:50 表示有已知尺寸依据的技术比例。单张未标定照片不能证明真实米制尺寸；没有尺寸事实时注明示意比例/非测绘，不伪造精确测量。示例中的 0.8 米只适用于该段明确授权的调度，不能作为所有角色之间的默认距离。

奶茶店、林楚楚、高探员、学生队列、标语、绿色饮料轨迹、双卷膜封口机、CAM 1/CAM 2 均为示例事实；只在当前场景或用户要求确实包含时使用。无参考照片的任务用已确认空间事实，不声称“严格匹配参考照片”。

## 可执行完整图提示词骨架

```text
A professional high-detail 90-degree orthographic top-down architectural floor plan and action blocking diagram of 【CURRENT SCENE】, 【VERIFIED REFERENCE AND SCALE BASIS】.

Spatial Layout Corrected to Reference:
【ACTUAL WALLS, ENTRANCES, WINDOWS, FIXED LANDMARKS, FURNITURE, EQUIPMENT, MATERIALS AND PASSAGES】

Character Positions & Tight Blocking:
【CURRENT CHARACTERS, VERIFIED COSTUMES, POSITIONS, FACINGS, RELATIVE DISTANCES AND ACTION STATES】

Action Trajectories:
【ACTUAL ACTION ORIGIN, PATH, TARGET, ARROW DIRECTION, BILINGUAL LABEL AND IMPACT MARKERS WHEN APPLICABLE】

Director Camera Cones:
【ACTUAL NUMBERED CAMERA POSITIONS, VIEW DIRECTIONS AND FRAMING CONES】

Style: Clean 3D architectural cutaway blueprint, sharp vector annotations in bilingual English and Chinese, 【SOURCE-GROUNDED MATERIALS】, 16:9 widescreen, studio lighting. Strict 90-degree orthographic top-down view; preserve reference topology and current blocking facts.
```

模板由 Agent 填入真实事实后才构成可执行提示词；不把占位符提交图片模型。来源原文完整保留供复用，但无关剧情不得污染当前资产。

## 资产职责与执行合同

完整站位图包含人物、轨迹和机位，属于 blocking 生产图，不得登记为无人 `scene-card/v1` 空间锚。纯空间拓扑底图只取上述空间、参考、材质与顶视要求，人物和标注归最终站位图。既有工作流的 `backgroundPlan` 目前只承载无人底图；不得把完整图塞入底图后再次叠画人物，造成重复角色和冲突箭头。执行方式必须如实区分完整图生图与当前坐标合成，不能只更新文档就宣称执行器已完成切换。生成及画布落点使用正式 tapcanvas-api 路径，保留已有产物。
