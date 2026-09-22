# 离线 `.director` 工程

工程是 UTF-8 JSON，桌面版和网页版共用格式。旧单段格式为 **1**；带外部资源的单段格式为 **2**；软件正常保存使用 **3**，在同一工程内承载多个独立戏段。三个版本都可导入。不要将软件版本号写成工程格式版本。资产目录与配套软件构建一致；新增资产需要对应的新版本或当前开发网页版，旧安装包不会自动获得新白模。

有 Node.js 22 或更高版本时，从 skill 所在目录运行 `scripts/project-tool.mjs`。脚本自包含，不需要安装 npm 包、启动导演台、联网或填写 API key。

```sh
node scripts/project-tool.mjs assets query.json
node scripts/project-tool.mjs create base.director --template street --duration 10 --fps 24 --aspect 16:9 --name 场次
node scripts/project-tool.mjs inspect base.director
node scripts/project-tool.mjs apply base.director operations.json finished.director
node scripts/project-tool.mjs validate finished.director
```

上述是可用命令示例，不是每次必走的步骤。`query.json` 可写 `{"query":"桌","details":true}`；多种物件用 `{"queries":["desk","chair","blackboard"],"details":true}` 一次查询所需参数。query 内空格词取交集，queries 取并集；其他筛选条件仍取交集。空请求不返回目录，默认最多 8 条；found:false、missingQueries/missingIds 表示没有匹配。已知 ID 和参数直接 apply。只有用户明确要浏览整库才使用 `catalog`，不例行扫描或翻完全部页。

仅几何体模式通过 `{operation:"project",patch:{creationMode:"geometry"}}` 开启；`full` 恢复完整资产，省略时默认 full。模式按戏段保存，不转换、删除已有物体。几何模式复用 16 种形状：`shape-box`、`shape-sphere`、`shape-cylinder`、`shape-cone`、`shape-capsule`、`shape-torus`、`shape-pyramid`、`shape-plane`、`shape-wedge`、`shape-ramp`、`shape-arch`、`shape-hemisphere`、`shape-tube`、`shape-l`、`shape-u`、`shape-arc`，均为 prop。已知 ID 与尺寸时直接添加；圆弧 angle、截面 thickness、细分 segments 等参数未知时，使用 assets 命令以 `{ids:["具体ID"],details:true}` 定向查询，不扫描全库或人形动作。基本尺寸写 `patch.assetParameters:{width,height,depth}`（米，每轴 0.02—500，通常默认 1；shape-plane 的默认高度为 0.04），底面中心为 position，rotation 弧度，scale 默认 [1,1,1]，color 为 #RRGGBB。人物用单个胶囊命名上色加 path，不加人形动作；notes.actorId 留空，正文注明角色名。家具建筑组合静态形状，门洞留真实空隙；多个形状不会自动绑定移动。摄影机仍用 asset:camera。模块也导出 `geometryCreationGuide()` 供程序按需读取同一约定。

create/apply/scene 写文件均不覆盖已有输出文件；修改现有工程先读用户提供的文件，另存新文件。create 支持 blank、room、park、street、courtyard、bedroom；改变模板总时长时，模板内现有路径、动作及切镜时间同比缩放。`catalog` 输出真实资产、动作、关节、场景模板和默认对象字段；`inspect` 提供对象完整信息，但不输出参考图图片字节。

`operations.json` 是与在线 director_apply 相同的操作数组，离线不需要 revision 或 requestId。例如在街道模板中添加一个有走位的人物：

```json
[
  {"operation":"add","asset":"woman","id":"actor_a","name":"人物甲","position":[0,0,0],"patch":{
    "color":"#a7bdd7","height":1.65,
    "path":{"smooth":false,"points":[{"time":0,"position":[0,0,0]},{"time":5,"position":[2,0,-3]}]},
    "clips":[{"id":"a_walk","action":"walk","start":0,"end":5,"speed":1},{"id":"a_idle","action":"idle","start":5,"end":10,"speed":1}]
  }}
]
```

可用操作为 add、update、remove、project、cuts、notes、motion、replace-prop、resource、resource-remove、clear-inherited-pose、camera-motion、lighting-preset。基本编辑见[编辑约定](editing.md)，镜头／灯光见[参数说明](camera.md)，实际校验复用在线工具契约。`motion` 操作可查询模块导出的 `motionPresets()` 获得真实预设 ID；涉及内置素材资源的操作使用异步 `applyOperationsWithResources`。嵌套对象／数组通常整体替换；patch.camera 按顶层字段合并，内部数组仍整体替换。新增摄影机使用 `asset:"camera"`，绑定和切镜引用实际 ID。用 inspect 获取初始机位 ID 后可修改或替换切镜。锁定对象仍受到保护。

需要程序化大量建模时，可以导入该模块的 `createScene`、`entity`、`clip`、`applyOperations`、`assertProject`、`ASSETS` 等命名导出，生成后先 assertProject，再写 `.director` 文件。不要让用户安装整个源码工程。

## v3 多戏段工程与离线编辑

同一戏段的命名区域 `zones` 和摄影机视线关键帧 `camera.targetPath` 也可通过离线 apply 写入；区域见[编辑约定](editing.md#多戏段检查与交付)，视线见[镜头说明](camera.md#独立视线路径)，在线与离线共用格式。zones 属于当前戏段状态，标记不进入视频；targetPath 使用独立的世界注视点时间表，不能当作摄影机位置路径或人物绑定。

所有模型沿用实体 `color:"#RRGGBB"`，不需要调色板专属数据。导入模型显色还需 `external.appearance:"color"`；设为 `original` 恢复原材质，`white` 为白模。更新 external 时先读现值并保留 resourceId、比例、骨架及其他设置，不能只用 appearance 覆盖整个 external。

```sh
node scripts/project-tool.mjs scene base.director copy.json multi.director
node scripts/project-tool.mjs scene multi.director list.json
node scripts/project-tool.mjs apply multi.director operations.json revised.director
node scripts/project-tool.mjs continuity revised.director scene-b
node scripts/project-tool.mjs validate revised.director
```

其中 `copy.json` 为 `{"action":"copy","name":"第二场","newSceneId":"scene-b"}`，`list.json` 为 `{"action":"list"}`。复制使旧文件迁移为 v3 并选中新段；apply 仅修改当前段，保留其他段与前情快照。`scene` 查询 list/read 不带输出文件；写入支持 create/copy/switch/rename/reorder/remove，必须带新的输出文件名。create 可指定 template，默认 blank；switch/rename/remove 指定 sceneId；reorder 的 sceneIds 必须包含全部戏段 ID 各一次。离线不需要 revision/requestId。

v3 外层为 `{format:"director-desk",version:3,name,activeSceneId,resources,media?,scenes}`；可选 media 是多戏段共享的图片／视频源数组。scenes 每项为 `{id,name,state,origin?}`。state 存放该段 duration/fps/aspect/room/entities/cuts/references，以及可选 creationMode/referenceLabels/production/zones/floors/editorView/lighting；不嵌套 format/version/name/resources 或另一整份工程。外部源文件由外层 resources 共享；人物和道具实例、路径、动作、切镜、参考图和备注分别属于各段。段内实体 ID 唯一，跨段沿用同一人物的 ID 以保持身份。

优先用模块导出的 `readSceneDocument`、`projectForScene`、`updateDocumentScene` 和 `editIndependentScene` 完成转换和编辑；不要对 v3 外层调用只接收单段的 `assertProject`，命令行 validate 会验证整份文档及源段快照。

`origin` 是引擎实际采样产生的前情证据，包含源段 ID/名称、最后输出帧、源状态与剧情快照、对象实际站位和源内容摘要。保留原样，不能因编辑新段而重写或删减。末帧是按帧率和时长计算的最后输出帧，不直接用 duration 时刻冒充；例如 10 秒 24fps 的末帧时刻为 239/24 秒。离线 `scene continue` 会明确拒绝，需在网页“从末帧接拍”或在线工具运行实际求值，再保存文件。可以离线读取已有快照；不能声称离线已经验证了末帧画面。

共享 resources 也可能只被非当前段或 origin 使用；删除资源前检查所有段及快照。资源文件相同则共享，实例摆放和调度独立。正常工程导出带全部段；单段模板和当前段视频的范围不同。

## 无脚本环境下的单段完整结构

不能执行脚本时也可以直接编写 JSON；必须带齐以下结构并说明未自动校验，不能只给缩写操作数组冒充可导入工程。基础模板见 [minimal.director](../assets/minimal.director)，先复制再编辑。它只包含地面和一台摄影机，没有测试剧情或角色素材。

根字段：

| 字段 | 要求 |
| --- | --- |
| format / version | `"director-desk"` / `1` |
| name / duration | 名称不超过 200 字；正数秒数，按任务决定时长 |
| fps | 24、30、50、59、60、90、120 |
| aspect | 9:16、16:9、21:9、3:4、4:3、1:1 |
| creationMode / referenceLabels（可选） | `"full"`／`"geometry"`；`referenceLabels:true` 让人物、群演组与胶囊名称进入参考视频，默认 false。均按戏段保存 |
| room | `{enabled,width,depth,height}`，尺寸均为 2.3—10000 米；室外 enabled=false，另放 ground |
| entities / cuts / references | 对象数组、切镜数组、参考图数组；无参考图时 `[]` |
| production（可选） | `{fixedPrompt,sceneReferenceIds,notes}`；每条备注 `{id,start,end,actorId,story,emotion,dialogue,action}`；未绑定演员用空 actorId |

production 可附 `promptText` 字符串（最长 100000 字），保存该段完整视频提示词，旧工程可省略。它与 fixedPrompt（项目风格固定头）、notes（按时间保存的剧情素材）不同。按[配套提示词格式](prompt-writing.md)写作并另附逐场 TXT；编辑 notes 时保留未改的 promptText。新接拍段保留风格头，但不照搬前段成稿。

`notes` 编辑操作的 `value` 是整个 production 对象（不是数组或 patch），其中各字段必须齐全；未填写的文字用 ""，没有图片用 sceneReferenceIds:[]。数组整体替换，保留不打算修改的旧备注与固定提示词。错误会指出具体 production 字段；无效输入不会静默清空已有备注。

所有对象共用字段：

```json
{
  "id":"actor_a","kind":"actor","asset":"person","name":"人物甲",
  "color":"#a7bdd7","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],
  "visible":true,"locked":false,"height":1.75,"build":"normal","gender":"male",
  "path":null,"face":"path","faceTarget":"","clips":[],"pose":{},"poseKeys":[],
  "camera":null,"count":12,"spacing":0.75,"seed":42,"reference":""
}
```

kind 为 actor / prop / camera / crowd，必须与资产类型匹配。actor 包括人形与动物，具体查看 catalog 中的 family 和 capabilities；不要仅凭 kind 推断人形。person / woman 保留旧版人物，新人物、动物和形状的 ID 从 catalog 查询。entity/add 会采用目录中的默认身高等字段，直接编写 JSON 时须自行填写。其他字段即使暂时不用也保留。build 为 slim / normal / broad，height 为 0.2—10 米（动物总高允许 0.03—10 米），count 为 1—1000 整数，scale 各轴大于 0。id 只使用字母、数字、中文、下划线、冒号、点和短横线，不含空格，工程内唯一。

动物当前提供待机、关节姿态及路径位移，自然步态、飞行和游动尚未接入；不要添加人形 walk/run/sit 等片段或 footContact=true。支持关节从每个资产的 joints 查询；旧人形沿用标准人形关节。四足动物头部沿用 head/headYaw，leftArm/rightArm 与 leftElbow/rightElbow 为前腿上下段，leftHip/rightHip 与 leftKnee/rightKnee 为后腿上下段；不把路径位移称为已验证的自然行走。鸟类使用 leftWing/rightWing 抬翼和后腿关节，鱼类使用 leftFin/rightFin 胸鳍与 tail/tailTip 尾部关节；蛇形使用 torso、tail、tailTip 侧向弯曲及头部关节。两侧翼／鳍的正角度均表示抬起，尾部为侧向转动。不能给鱼或蛇添加人形肩肘／髋膝字段。始终以资产 capabilities.actions / pose 和 joints 为准。动物 height 表示默认姿态总高，鱼包含背鳍；人形 height 不包含帽盔外沿。

人物动作：idle、walk、run、sit、standup、crouch、crawl、jump、lie、fall、wave、point、turn。每个动作片段 `{id,action,start,end,speed}`，同一对象不可重叠，end>start，speed>0。空档为待机。基础动作并不自动产生走位，需要同时设置 path。

路径 `{smooth,points:[{time,position:[x,y,z]}]}` 至少一个点，时间严格递增；重复位置加不同时间形成停留。坐标为绝对世界坐标，Y 可以变化。路径开始前保持第一个点，结束后保持最后一个点。通常将动作、路径和剧情备注安排在项目时长内；不要依靠文件校验器推断用户期望的播放范围。

rotation 用弧度；pose 和 poseKeys 中关节角度用 **度**，不是弧度。人形关节可选 head、headYaw、torso、leftArm、rightArm、leftElbow、rightElbow、leftHip、rightHip、leftKnee、rightKnee；动物按每资产 joints 选择，验证器拒绝不支持的关节。角度绝对值不超过 360。poseKeys 为 `[{time,pose}]`，不重复时间。face 为 path / fixed / target，fixed 使用对象朝向，target 需要有效 faceTarget。可选 actionBlend 为 0—2 秒，footContact 为布尔值。

完整工程 JSON 中的摄影机实体使用 kind=camera、asset=camera；这不等于 add 操作的参数。使用在线／离线 apply 新增内置白模和摄影机时省略 kind，工厂会自动填入实体 kind。camera 字段必须为：

```json
{"aim":"target","focal":28,"target":[0,1,0],"targetId":"","targetHeight":1.2,"mode":"free","offset":[0,1.6,-1.8],"inheritRotation":true,"hideWalls":[]}
```

aim 为 target 或 manual；focal 为 8—300 毫米。free 机位可用自己的 path；targetId 指向人物或道具时可跟踪瞄准；follow / pov 通过 targetId 绑定非摄影机对象并使用 offset。人物本地前方为 +Z，POV 可从 `[0,1.67,0.13]` 偏移起步，必须实际预览检验。hideWalls 可选 north、south、east、west、ceiling；不要默认隐藏白模以掩盖不合理机位。

cuts 必须至少一条，第一条 `{"time":0,"cameraId":"有效机位ID"}`。时间严格递增且小于 duration，每段一直持续到下一个 cut，最后一段到项目结束。切镜不重新启动摄影机或人物的运动。

prop 资产：ground、road、building、bench、fence、streetlight、bed、nightstand、wardrobe、desk、chair、sofa、table、lamp、laptop、cup、sword、car、tree、rock、cube、sphere、cylinder、wall、stairs、door。群演资产 crowd，kind=crowd，可设置 count、spacing、seed 以及共享路径和动作；固定 seed 保持队列一致。

ground、road、wall、stairs 支持可选 parameters 对象。道路／地面用 width、length、height，墙体 length 沿本地 X、width 为厚度，楼梯用 width、steps、rise、tread、landing、layout。尺寸 0.02—500 米，每段 steps 为 1—128，layout 为 straight（单向上升）、crest（上升后下降）、return（折返继续上升）。楼梯从本地原点沿 -Z 上升，真实几何仍受 rotation、scale 影响。其他资产不要添加这个旧 parameters 字段；新白模使用下一节的 assetParameters，未提供参数的资产才使用 scale。

新参数化资产通过 `assetParameters` 编辑；允许的字段、默认值、单位与范围从 catalog 中该资产的 `parameters` 描述查询。例如 `shape-arch` 可设置 `{"assetParameters":{"width":3,"height":2.5,"depth":0.3,"thickness":0.18}}`，其中 thickness 是截面厚度比。与旧楼梯的 `parameters` 字段分开，不混用，不添加目录未列出的参数。`assets` 查询结果中的 `parameterPatchField` 明确给出编辑字段，`details:true` 提供 `addExample`；这是字段路由，不应把 catalog 的参数定义直接当作数值。

家具同样使用 `assetParameters`。例如书架 layers 必须为整数，衣柜 opening 单位为度，带承托面的家具 surfaceHeight 不得超过主体 height 的 80%。家具宽高深描述主体，实际边界包含外伸把手和打开的柜门。在线 `director_spatial` 的 `objects[].contactAnchors` 提供当前座位、床面、台面、层板等参考点的世界 position 和 normal，id 在相同结构中稳定；修改结构后重新查询。参考点不等于已完成自动接触或拿放动作。离线工具可设置结构参数，不声称已运行引擎求值或射线检查。

新建筑／通行／道路资产也使用 `assetParameters`（从 catalog 查询字段）。`structure-wall` 的 openingWidth 为 0 表示封闭墙；正值洞口由 openingHeight 与 sill 定义。门窗 opening 为度；窗是无玻璃白模框架。新楼梯 `structure-stairs-straight/l/u/crest/spiral` 各有目录参数，与旧 stairs 不混用。空间查询的 contactAnchors 包含每级踏步或坡面；normal 是考虑旋转和非等比缩放后的单位世界法线。结构修改后需要重新查询并人工／工具调整旧路径，不假定自动联动。

`road-straight/curve/junction/bridge/parking` 的实体原点在路面顶面，厚度向下；`road-sidewalk/curb` 从原点向上抬高。弯路原点在圆心，radius 为中心线半径，width 为路宽，turn 为角度。公交站亭以地面为原点，座位参考点可通过空间查询读取。查实际边界及参考点后再连接模块，不使用所有结构都是中心原点的假设。

建筑外壳 `building-*` 的 floorHeight 是层高，levels 是层数；主体尺寸不含屋檐，实际范围通过在线空间查询确认。contactAnchors 提供各层楼板，楼梯和陈设另行搭建。不要把外壳当作已完成内装场景。

植物 `plant-*` 的 width/height/depth 为实际外形尺寸，density 控制枝叶密度，assetParameters.seed 固定外形（不是群演用的实体 seed）。地形 `terrain-*` 以底部为原点，部分支持 roughness 与 seed；沟渠和河床有真实凹槽，水面为静态占位，无流体仿真。按原工程保留种子，跨镜头不随意重新随机化。

`vehicle-*` 提供可用座位的 contactAnchors；当前只有整体路径，不自动驾驶、转动车轮或把人物放入座位。`industrial-container` 的 opening 为度，打开后重新查询实际边界。脚手架 levels、兵器架 slots、祭坛 steps 分别控制平台、架位和台阶数量。

参数 schema 中 choices 表示离散数值选项，按键名转换为数字存入 assetParameters；例如 theme-stall 的 canopy=0/1，theme-ring 的 ropes=0/1，theme-flagpole 的 flag=0/1。关闭部件后实际几何和空间边界会变化，剩余部件尺寸保持不变；参数尺寸描述完整预设，不要要求关闭旗面后仍有原旗面宽度。

reference 字段引用 references 中的 ID。图片项为 `{id,name,data}`，data 必须是真实 PNG/JPEG/WebP 的 base64 data URL；不要编造图片字节或填本机绝对路径。没拿到图片就保留空数组和空引用。

## 外部模型、手持与楼层

外部文件可在软件中导入；离线若已取得真实模型文件，可用模块的 `packModelFiles(entry, [{path,bytes}, ...])` 打包相对路径的源文件，再用异步 `modelResourceId(package)` 计算内容 ID。资源项为 `{id,name,package,copyright,license,source}`，写入 v2 的 resources 或 v3 的共享 resources。保留许可信息，不能捏造不存在的文件、贴图、骨架或授权。源文件的绝对路径不能写进 package；包含关联贴图、MTL、BIN 等被引用的实际文件。文件打包通过不代表渲染／骨架已通过检查。

用 `add` 的 asset 指定已有资源 ID，kind 可选 actor/prop（默认 prop）；生成 asset=`external-model` 的实例。`external` 包含 resourceId、appearance=`original|white|color`、unitScale、orientation（XYZ 弧度）；人物需要 humanoid rig 映射后才能套用人形素材。无骨架模型仍可做静态占位和整体路径移动。不要自动假定 Blender 或 3ds Max 原生文件可以直接读取。

带原生动画的 clips 使用 action=`native` 和 native 数据，索引来自实际加载报告；跨骨架使用 action=`retarget`，携带源资源、骨骼映射和校准。需要素材动作时优先查询 motionPresets 并调用 `motion` 操作，减少手工拼接。基础 walk/run/crawl/lie/fall 等仍按实际目标能力选择。复杂骨架必须在运行中的软件验证。

独立动作支持包含骨架和动画的 FBX、GLB/glTF，无网格的来源只用于 retarget，不能作为 external-model 场景实例。用户动作库仅在本机保存；在线查询 `director_motions({source:"user",query:"动作名"})` 后使用返回 id 执行 motion。应用后仍是本节的标准 resources＋retarget 片段，工程跨机器打开不依赖原动作库。离线不能仅写一个 user-motion 收藏 ID，须保留实际资源包、来源骨架映射和 retarget 片段；没有源文件就说明缺少素材，不伪造资源或映射。

动作片段可带可选 `name`（1—100 字的非空名称），用于时间轴显示，随裁剪和工程保存；省略时使用既有默认动作名称。用户动作应用后会复制收藏名称，后续修改收藏不改动已排片段。

道具 `handBinding={actorId,hand:"left"|"right",offset:[x,y,z],rotation:[x,y,z]}`；offset 为随手旋转的米制偏移，rotation 为相对弧度，缩放独立。绑定覆盖整段且要求 path=null。解绑同时回填空间查询的世界位置和 rotationRadians 可保留当前摆放；不能离线由基础 position 推断动画中手的实际坐标。

单段 floors 为 `[{id,name,elevation}]`，实体 floorId 表示归属，editorView 包含 activeFloorId/hiddenFloorIds/hiddenEntityIds/hideWalls；可选 trackOrder 是轨道键数组（entity:对象ID、path:对象ID、note:备注ID），仅控制编辑器排序，切镜固定置顶。省略保持默认，新轨道追加，已删除轨道键忽略。楼层升降会移动未改归属的对象和整条路径，手持道具跟随人物，锁定受影响对象会拒绝操作。仅改归属不移动对象。编辑器隐藏不影响真实机位输出。

静态模块 `structureLink={parentId,parentPort,ownPort,offset:[x,y,z],rotation:[x,y,z]}` 连接已查询到的端口；不支持循环、动画模块或与手持并用。父模块变化在同一事务传播，锁定下游会拒绝。断开用 structureLink=null，保留当前世界变换。它不是网格布尔合并，不会自动开洞或重画人物路径。

接拍实体可含 initialPose，由真实模型节点采样产生。离线必须保留，不能改写节点路径／四元数伪造延续。首个新动作开始前保持继承姿态，之后新动作接管；需要清除用 `clear-inherited-pose` 操作。结构和比例变化可能使旧快照失效。

## 镜头与灯光

需要设计机位、视线、连续运动、速度曲线、镜头效果或灯光时，读取[镜头与灯光参数](camera.md)。在线与离线共用这些字段，省略新参数保持旧行为。

## 导入与校验边界

交付真正的 `.director` 文件，附简短说明：“在网页版点击打开，选择此文件”。用户已有工程时交付新版本，不覆盖原件。文件生成和结构校验不依赖桌面版、MCP 或模型 API。

校验器复用软件的格式、引用和时间规则，不能离线证明人物在画面中、无遮挡或没有穿模。有可操作的浏览器时，应在网页版导入，检查不同时刻的实际机位画面和播放；没有时明确请用户预览，不宣称完成视觉检查。视频仍由网页版或桌面版实际渲染导出，不能把 JSON 当成成品视频。

自动化补丁：`patch.camera` 支持按顶层字段合并（例如仅改 focal），内部数组整体替换，其余嵌套补丁沿用整体替换规则。`motion` 操作可附 `duration` 指定正秒数并向上取整到帧，省略仍用目录默认时长；离线 apply 与在线复用相同规则。在线的 previewId 是运行中窗口的临时预检引用，离线 operations 文件仍提供完整操作数组。

### 自定义速度曲线与修改定位

速度曲线见[镜头与灯光](camera.md#自定义速度曲线与修改定位)。在线提交自动生成本机「AI 改动」记录，返回 changeId；无需另调工具，记录不进入工程。

## 媒体与抽象元素

导入图片／视频或设置表面、粒子、影响区域、形变和扭曲时，读取[媒体与抽象元素](media.md)。其中包含离线 import-media 命令和共用字段；不包含声音。
