# 媒体与抽象元素

用户需要时定向查询视觉元素、影响区域或空间扭曲，不扫描全库。`director_media(action:"list")` 查工程已导入的媒体；`action:"surfaces",entityId` 查网格／材质槽。桌面导入用 `action:"import",path,revision,requestId`，可带 entityId 直接承载；不要让模型输出大段 base64。详细 surface、visual、field、deform、warp 数据按需查 `director_help(names:["director_media"])`。普通修改仍用 director_apply，复用现有关键帧曲线和撤销。

surface 是物体实际显示的材质／媒体，旧 references 是历史参考素材，两者不混用。发光材质不会照亮周围，需要真实灯光；聚光灯可携带一层媒体用于投影。烟火／流体使用确定性视觉近似；屏幕扭曲不改变空间射线报告。镜面、传送门内部不递归绘制彼此。视频画面随工程时间定位，声音忽略。`director_read(sections:["resources"],details:true)` 含资源使用情况；`sections:["statistics"]` 返回渲染与媒体运行状态；按实际需要查询，不增加固定验收轮次。

## 字段与离线导入

图片／视频导入：`node scripts/project-tool.mjs import-media 输入.director 素材.mp4 输出.director [承载对象ID]`。PNG/JPEG/WebP/MP4/WebM；不包含声音。源随工程内嵌，不写本机路径。v3 文档顶层可有 media 数组，多戏段共享；单戏段投影 Project.media 相同格式。资源为 `{id:"media-<sha256>",name,mime,data:"data:<mime>;base64,...",width,height,duration}`。同一 ID 的内容不原地修改。

模块方式可 import `mediaFromBytes(name,mime,Uint8Array)`、`defaultSurfaceLayer(resourceId)`、`defaultVisual(preset)`，再用同一 applyOperations 和 assertProject。对象 `surface:{layers:[defaultSurfaceLayer(id)]}`，`surface:null` 恢复原材质；层 crop 为左上起点归一化 `[x,y,w,h]`，mesh/material=-1 全部，mapping 为 uv/plane/box/sphere/cylinder，face 为 all/front/back/left/right/top/bottom。offset=[0,0]、repeat=[1,1] 是贴图尺寸、rotation 为度、tile 为重复开关，fit=stretch/contain/cover。opacity 可关键帧，unlit 控制屏幕自发光；start/trimIn/trimOut/speed/loop 控制视频时钟。trimOut=0 全长，loop=false 保持末帧。层最多 8 个，light-spot 只用一层投影；其他灯不支持媒体。roughness、metalness、transmission、opacity 为 0—1，emissive 0—20，均可关键帧；ior 为 1—2.5。

视觉元素直接以目录中 `visual-*` 资产新建，完整 defaults.visual 可复制再修改。`count` 1—50000，seed 固定分布，lifetime 控制粒子周期／轨迹带保留秒数，size/spread/speed/amplitude/frequency/opacity 支持数字或 `{keys:[{time,value,easing?}]}`；start/end 控制出现时段（end=0 到戏段结束）。文字用 text，颜色用实体 color + secondaryColor，混合用 additive，质量 draft/normal/high。portal.cameraId 指定同场景另一摄影机，其内部渲染不叠加镜头后期和名称标签；镜面与传送门不相互递归取景。图片／视频背景可用 visual-panorama 的内向球面 + surface，或 visual-screen 平面。

影响区域 `field-*` 用 field={type,radius,strength,falloff,targets:[],start:0,end:0}；type 为 wind/attract/repel/vortex/turbulence/wave，strength 可关键帧，空 targets 作用于视觉元素，非空指定对象 ID。风沿局部 +Z。粒子逐点响应，其他对象做整体位移。空间扭曲 `warp-*` 用 warp={type,radius,strength,frequency,speed}，type=lens/heat/swirl/blackhole/ripple，strength 可关键帧且范围 -2—2。最多同时显示 8 个 field 和 8 个 warp。

对象形变用 deform={type,amount,axis:"y",frequency:2,speed:1,seed:42} 或 null；type=bend/twist/inflate/squeeze/stretch/wave/collapse/shatter，amount 可关键帧 -10—10。变形修改真实网格顶点；三角面破碎不做碰撞刚体模拟，低面数模型不自动变成精细曲面。

性能与结果：完整预览和导出纹理最长边 2048，流畅预览最长边 1024，原文件不降采样；相同媒体时钟共享纹理，连续播放复用解码器，没有换帧就不重复上传纹理，支持的编码优先低延迟软件解码（GPU 渲染保持启用），不支持时沿用平台选择，草稿粒子绘制 1/4 数量；镜面／传送门 512/1024/2048 分档。烟火水流为视觉近似，光束／光斑是透明形体，不是体积散射；发光材质本身不照亮其他物体。网格映射按局部部件，不自动无缝展开。粒子包围盒和屏幕扭曲不代表精确空间碰撞；这些限制不要表述成物理仿真。所有效果使用工程时间和固定种子，导出等待所需视频帧。

接拍相位：surface.layers、visual、field、deform、warp 的可选 timeOffset 默认为 0，用于保留前段结束时的播放或程序动画相位；通常由接拍操作自动填写。
