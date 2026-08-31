"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBookStoryboardDirectorV12Fixture = createBookStoryboardDirectorV12Fixture;
exports.createTaskStoryboardDirectorV12Fixture = createTaskStoryboardDirectorV12Fixture;
const types_1 = require("./types");
const SHOT_ONE_EXIT_STATE = "顾宁右手握住空白信封，铜钥匙仍在顾宁左侧外套口袋；许舟左手悬在身侧；两人同时朝走廊尽头停住";
function createShot(input) {
    return {
        shotId: input.shotId,
        durationSec: 3,
        beatRole: input.beatRole,
        narrativeGoal: input.shotId === "SHOT_01" ? "建立逼问与遮掩的压力" : "用脚步声把对峙推向外部威胁",
        subjectAnchors: ["许舟左手腕固定并悬在身侧", "顾宁深色外套与右手空白信封"],
        crowdRelations: [],
        scene: {
            location: "旧档案室",
            timeOfDay: "夜间",
            weather: "室外持续下雨",
            environmentDetails: ["金属档案柜形成狭窄通道", "走廊冷光从半开的门切入室内"],
        },
        rigAndPose: {
            centerOfMass: "许舟重心落在右腿，顾宁重心后撤半步",
            limbConstraints: ["许舟左腕不承重", "顾宁左手不离开外套口袋附近"],
            forbiddenPoses: ["许舟不得用左手撑桌或抓人"],
            keyPoseNotes: "两人身体朝向彼此，视线在脚步声出现后共同转向门外",
        },
        camera: {
            shotSize: input.shotId === "SHOT_01" ? "中近景" : "双人近景",
            angle: "平视轻侧角",
            height: "胸口高度",
            lensMm: 50,
            shutterAngleDeg: 180,
            movement: input.shotId === "SHOT_01" ? "缓慢前推" : "停止推进并轻微横移至门口方向",
            focusTarget: input.shotId === "SHOT_01" ? "顾宁取出空白信封的右手" : "两人同时转向门口的反应",
        },
        lighting: {
            keyDirection: "门外右后方冷光",
            keyAngleDeg: 40,
            colorTempK: 4800,
            contrastRatio: "4:1",
            fillStyle: "室内旧灯低强度漫反射",
            rimLight: "冷光勾出肩线与信封边缘",
        },
        actionChain: input.shotId === "SHOT_01"
            ? ["许舟右手按住桌沿逼问", "顾宁把右手伸进口袋", "顾宁只取出空白信封"]
            : ["走廊脚步逼近", "许舟与顾宁同时停住", "两人视线转向半开的门"],
        composition: {
            foreground: "虚焦档案标签与桌角",
            midground: "许舟和顾宁形成斜向对峙",
            background: "半开的门与被冷光切亮的走廊",
            spatialRule: "顾宁靠近门侧，许舟挡住室内退路，保持既定轴线",
        },
        dramaticBeat: {
            before: input.shotId === "SHOT_01" ? "许舟完成拦截" : SHOT_ONE_EXIT_STATE,
            during: input.shotId === "SHOT_01" ? "顾宁用空白信封回应逼问" : "脚步声迫使双方中止对峙",
            after: input.exitState,
        },
        performance: {
            emotion: input.shotId === "SHOT_01" ? "许舟克制怀疑，顾宁保持防备" : "两人警觉并暂时共享外部压力",
            microExpression: input.shotId === "SHOT_01" ? "许舟下颌绷紧，顾宁眨眼频率降低" : "两人瞳孔同时转向门口",
            bodyLanguage: input.shotId === "SHOT_01" ? "许舟保护左腕，顾宁肩膀后收" : "动作同时冻结，身体朝门口偏转",
        },
        continuity: {
            fromPrev: input.continuityFromPrev,
            persistentAnchors: ["许舟左腕骨裂状态不变", "铜钥匙始终由顾宁持有", "门在画面右后方"],
            forbiddenDrifts: ["禁止许舟左手正常发力", "禁止钥匙易主", "禁止改变门与人物的轴线关系"],
        },
        continuityLocks: {
            identityLock: ["许舟与顾宁面部、发型和基础服装不变"],
            propLock: ["空白信封在顾宁右手，铜钥匙在顾宁左侧外套口袋"],
            spaceLock: ["顾宁靠门、许舟靠室内的相对位置不变"],
            lightLock: ["门外冷光与室内暗黄灯的方向和色温关系不变"],
        },
        exitState: input.exitState,
        storyFactLocks: {
            effectiveAt: { chapter: 5, sequence: input.effectiveSequence, label: input.shotId },
            ...input.storyFactLocks,
        },
        readabilityChecks: {
            subjectReadable: true,
            relationshipReadable: true,
            lightingConsistent: true,
        },
        failureRisks: ["伤手动作漂移", "钥匙错误易主", "把人物怀疑拍成客观事实"],
        negativeConstraints: ["禁止现代电子设备", "禁止模糊失焦与面部变形"],
        prompt: {
            cn: input.shotId === "SHOT_01"
                ? "旧档案室双人中近景，许舟保护左腕并用右手按住桌沿，顾宁从外套口袋取出一张空白信封。"
                : "旧档案室双人近景，走廊脚步逼近，许舟与顾宁同时停止动作并转头看向半开的门。",
        },
    };
}
function createBookBindings() {
    return [
        {
            source: "story_fact",
            factId: "fact_injury_xuzhou_left_wrist",
            category: "character_state",
            status: "confirmed",
            visibility: "objective",
            directive: "许舟左手腕骨裂并固定，不承重、不抓握、不完成正常发力",
        },
        {
            source: "story_fact",
            factId: "fact_prop_copper_key_owner",
            category: "prop",
            status: "confirmed",
            visibility: "objective",
            directive: "铜钥匙仍由顾宁持有，不出现在许舟身上",
        },
        {
            source: "story_fact",
            factId: "fact_xuzhou_suspicion_letter",
            category: "knowledge",
            status: "inferred",
            visibility: "viewpoint_only",
            directive: "只表现许舟对顾宁隐瞒来信的怀疑，不把背叛表现为客观事实",
        },
        {
            source: "story_fact",
            factId: "fact_hidden_relation_04",
            category: "relationship",
            status: "confirmed",
            visibility: "hidden",
        },
    ];
}
function createBookRevealGuard() {
    return {
        source: "story_fact",
        factId: "fact_hidden_relation_04",
        notBefore: { chapter: 7, sequence: 0, label: "正式揭示点" },
        blockedChannels: [...types_1.STORYBOARD_SECRET_BLOCKED_CHANNELS],
    };
}
function createBookStoryboardDirectorV12Fixture() {
    const consumedFactIds = [
        "fact_injury_xuzhou_left_wrist",
        "fact_prop_copper_key_owner",
        "fact_xuzhou_suspicion_letter",
        "fact_hidden_relation_04",
    ];
    return {
        schemaVersion: "storyboard-director/v1.2",
        chapter: {
            bookTitle: "档案室之夜",
            chapterTitle: "第五章 空白信封",
            sourceSpan: "第 5 章档案室逼问片段",
        },
        globalStyle: {
            genre: "现实悬疑定格动画",
            visualTone: "低照度、克制、压迫",
            palette: "冷蓝灰与暗黄旧灯",
            aspectRatio: "16:9",
            fps: 24,
        },
        modelingSpec: {
            unitScale: "1m",
            topologyDetail: "mid-high",
            materialStyle: "stylized-pbr",
            textureAging: "旧纸张、金属氧化、潮湿墙面",
            clothBehavior: "厚重外套低摆幅",
        },
        stopMotionSpec: {
            fpsBase: 24,
            cadence: "onTwos",
            microJitterPx: 0.4,
            holdFrames: [2, 3],
            imperfectionPolicy: "保留轻微手工停格触感，不破坏身份与道具连续性",
        },
        atmosphereSpec: {
            tensionLevel: 0.82,
            airDensity: "潮湿密闭",
            humidityCue: "玻璃轻雾与旧纸返潮",
            windVector: "门缝向室内的弱气流",
            particleType: ["细尘"],
            soundProxySources: ["走廊脚步", "旧灯电流声", "雨点击窗"],
        },
        storyFactsContext: {
            mode: "book_ledger",
            bookId: "book-archive-night",
            ledgerRevision: 12,
            effectiveAt: { chapter: 5, sequence: 10, label: "档案室逼问开始" },
            consumedFactIds,
            consumedContextKeys: [],
        },
        cast: [
            { id: "char_xuzhou", name: "许舟", anchorTraits: ["短黑发", "左腕固定带", "深灰夹克"] },
            { id: "char_guning", name: "顾宁", anchorTraits: ["及肩黑发", "眼下浅痣", "深色长外套"] },
        ],
        relationshipGraph: [
            {
                from: "char_xuzhou",
                to: "char_guning",
                relationType: "visible_interrogation",
                intensity: 0.8,
                state: "互相防备且被外部脚步打断",
            },
        ],
        shots: [
            createShot({
                shotId: "SHOT_01",
                beatRole: "opening",
                continuityFromPrev: "许舟刚拦住顾宁，左腕已固定；顾宁仍持有铜钥匙",
                exitState: SHOT_ONE_EXIT_STATE,
                effectiveSequence: 10,
                storyFactLocks: {
                    bindings: createBookBindings(),
                    revealGuards: [createBookRevealGuard()],
                },
            }),
            createShot({
                shotId: "SHOT_02",
                beatRole: "payoff",
                continuityFromPrev: SHOT_ONE_EXIT_STATE,
                exitState: "许舟与顾宁保持原站位面向门口；空白信封仍在顾宁右手；铜钥匙未易主；脚步停在门外",
                effectiveSequence: 11,
                storyFactLocks: {
                    bindings: createBookBindings(),
                    revealGuards: [createBookRevealGuard()],
                },
            }),
        ],
    };
}
function createTaskStoryboardDirectorV12Fixture() {
    const fixture = createBookStoryboardDirectorV12Fixture();
    fixture.storyFactsContext = {
        mode: "task_context",
        sourceLabel: "用户本轮提供的独立故事片段",
        bookId: null,
        ledgerRevision: null,
        effectiveAt: null,
        consumedFactIds: [],
        consumedContextKeys: ["ctx_001", "ctx_002"],
    };
    const shots = Array.isArray(fixture.shots) ? fixture.shots : [];
    for (let index = 0; index < shots.length; index += 1) {
        const shot = shots[index];
        if (!shot || typeof shot !== "object" || Array.isArray(shot))
            continue;
        const shotRecord = shot;
        shotRecord.storyFactLocks = {
            effectiveAt: null,
            bindings: index === 0
                ? [
                    {
                        source: "task_context",
                        contextKey: "ctx_001",
                        sourceLabel: "用户明确给出的伤势约束",
                        category: "character_state",
                        status: "confirmed",
                        visibility: "objective",
                        directive: "许舟左手腕受伤并固定，不使用左手承重",
                    },
                    {
                        source: "task_context",
                        contextKey: "ctx_002",
                        category: "relationship",
                        status: "draft_choice",
                        visibility: "hidden",
                    },
                ]
                : [
                    {
                        source: "task_context",
                        contextKey: "ctx_001",
                        sourceLabel: "用户明确给出的伤势约束",
                        category: "character_state",
                        status: "confirmed",
                        visibility: "objective",
                        directive: "许舟左手腕受伤并固定，不使用左手承重",
                    },
                    {
                        source: "task_context",
                        contextKey: "ctx_002",
                        sourceLabel: "用户明确允许在第二镜揭示的关系变化",
                        category: "relationship",
                        status: "draft_choice",
                        visibility: "objective",
                        directive: "第二镜允许呈现用户明确给出的关系揭示",
                    },
                ],
            revealGuards: index === 0
                ? [
                    {
                        source: "task_context",
                        contextKey: "ctx_002",
                        notBeforeShotId: "SHOT_02",
                        blockedChannels: [...types_1.STORYBOARD_SECRET_BLOCKED_CHANNELS],
                    },
                ]
                : [],
        };
    }
    return fixture;
}
