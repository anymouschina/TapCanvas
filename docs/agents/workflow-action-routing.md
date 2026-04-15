# TapCanvas Workflow Action Routing

## 目标

把“大型完整工作流”拆成可管理的小动作，让 agents-cli 根据当前场景和状态选择下一步，而不是机械复制参考案例。

核心原则：

- 案例用于参考，不用于整套照抄
- 动作用于执行
- 状态用于路由
- 连续性优先于复杂度

## 一、先判断当前属于哪种场景

在任何创作任务开始前，先判断任务属于哪一类：

### 1. 从零起一个新场景

特征：

- 只有想法、剧情、镜头目标
- 还没有可靠视觉基底

优先动作：

- `create_base_frame`
- `lock_character_identity`
- `lock_environment_anchor`

### 2. 已有稳定图，想扩展成多镜头

特征：

- 已有一张或几张可信图
- 想派生侧面、POV、反打、近景、远景

优先动作：

- `change_camera_angle`
- `switch_to_pov`
- `adjust_prop_state`
- `review_continuity`

### 2.5 已有清晰镜头，想改成另一种视觉风格

特征：

- 已有动画截图、关键帧或稳定镜头
- 想保持同一个镜头语义
- 想迁移到真人写实、AAA 游戏 CG、国漫 3D 等风格
- 可能还要把稳定版本继续扩成固定机位动作视频

优先动作：

- `preserve_shot_semantics`
- `preserve_lighting_logic`
- `translate_style_domain`
- `polish_single_visual_variable`
- `prepare_locked_style_keyframe`
- `generate_fixed_camera_motion`

### 3. 连续性出问题，需要修图

特征：

- 人脸漂移
- 背景角色或空间关系漂移
- 道具状态不稳定

优先动作：

- `lock_character_identity`
- `lock_environment_anchor`
- `remove_background_noise`
- `review_continuity`

### 4. 已有稳定场景，准备植入一个超现实异常

特征：

- 世界本身已经可信
- 想加入一个标志、符号、异常物体或不可能规则
- 目标是先让异常被看清，再决定是否升级到视频

优先动作：

- `preserve_capture_modality`
- `inject_single_anomaly`
- `review_continuity`

### 5. 已有稳定关键帧，准备转视频

特征：

- 静帧可信
- 镜头和主体都已经稳定
- 目标是让画面动起来

优先动作：

- `prepare_video_keyframe`
- `generate_video_motion`
- `review_continuity`

### 6. 视频已经生成，但结果漂了

特征：

- 多余动作
- 人物变形
- 环境或镜头意图跑偏

优先动作：

- `review_continuity`
- `prepare_video_keyframe`
- `generate_video_motion`

关键原则：视频问题优先回到关键帧层修，不要在错误视频上继续叠加复杂指令。

## 二、再判断当前状态缺什么

建议用以下状态字段判断：

- `hasBaseFrame`
- `characterLocked`
- `environmentLocked`
- `cameraPlanReady`
- `keyframeApproved`
- `videoGenerated`
- `continuityPassed`

### 最常见的路由规则

- 如果 `hasBaseFrame=false`，不要直接扩镜头，先做 `create_base_frame`
- 如果 `characterLocked=false`，优先解决角色一致性，不要急着做 POV 或视频
- 如果 `environmentLocked=false`，优先锁环境，再做角度扩展
- 如果要做超现实设定植入，先锁定拍摄语法，再做 `inject_single_anomaly`
- 如果 `keyframeApproved=false`，不要直接做 `generate_video_motion`
- 如果 `videoGenerated=true` 但 `continuityPassed=false`，优先回到 `prepare_video_keyframe`

## 三、动作选择顺序

### 新场景推荐顺序

1. `create_base_frame`
2. `lock_character_identity`
3. `lock_environment_anchor`
4. `preserve_capture_modality`
5. `inject_single_anomaly`
6. `change_camera_angle`
7. `switch_to_pov`
8. `prepare_video_keyframe`
9. `generate_video_motion`
10. `review_continuity`

### 跨风格镜头改编推荐顺序

1. `create_base_frame`
2. `preserve_shot_semantics`
3. `preserve_lighting_logic`
4. `translate_style_domain`
5. `polish_single_visual_variable`
6. `prepare_locked_style_keyframe`
7. `generate_fixed_camera_motion`
8. `review_continuity`

### 多镜头推荐顺序

1. `review_continuity`
2. `change_camera_angle`
3. `switch_to_pov`
4. `adjust_prop_state`
5. `prepare_video_keyframe`
6. `generate_video_motion`

### 视频修复推荐顺序

1. `review_continuity`
2. 回退到最近稳定关键帧
3. `prepare_video_keyframe`
4. 重写 `generate_video_motion`

## 四、每个动作只改一件核心事

这是路由系统必须遵守的硬规则。

### 正确做法

- 这一步只换机位
- 这一步只改 POV
- 这一步只让书本合上
- 这一步只移除一个背景乘客
- 这一步只让稳定关键帧进入视频生成

### 错误做法

- 同时换机位、换情绪、换灯光、换道具状态
- 一边修角色漂移，一边让画面开始运动
- 在连续性不稳时直接生成视频

## 五、怎么利用参考工作流

参考工作流应该这样用：

1. 先从 `assets/demo/index.json` 找合适案例
2. 再从 `ai-metadata/workflow-patterns/index.json` 找分析入口
3. 读对应 `*.analysis.json` 理解模式
4. 只在证据不足时回看原始 `assets/demo/*.json`

参考工作流的用途是：

- 学动作顺序
- 学连续性策略
- 学 prompt 结构
- 学失败修复方式

不是：

- 整条链路照抄
- 把案例里的具体场景当模板硬套

## 六、新增 demo 工作流后的维护方式

每新增一个 `assets/demo/<id>.json`，建议同步补齐：

- `assets/demo/index.json`
- `ai-metadata/workflow-patterns/<id>.analysis.json`
- 必要时补新的 prompt patterns 文档
- 如果出现新的可复用动作，再补 `ai-metadata/workflow-actions/index.json`

## 七、agents-cli 的使用方式

当用户要求 agents-cli 协助做 TapCanvas 创作时：

1. 先判断当前属于哪种 `sceneType`
2. 再检查状态字段缺口
3. 从 `ai-metadata/workflow-actions/index.json` 选动作
4. 读取对应的 pattern docs 与 analysis
5. 执行动作并产出下一步候选动作

换句话说：

- 不是“读完所有工作流再回答”
- 而是“定位场景 -> 选择动作 -> 执行一步 -> 再决定下一步”
