import type { AuthoredChapterSequence } from '../../../../../packages/schemas/chapter-sequence/index.mjs';
import { sha256Hex } from '../asset/book-content-hash';

/** One creative brief supports an entire film; its clauses are not clip allocations. */
export function globalSequenceFixture() {
  const content = '60s 超燃打斗，3d玄幻动漫，正反派对抗，需要有铺垫后转场，切入高燃打斗，铺垫5s左右就行，有高光，有大招，有具形招式';
  const sourceId = 'acceptance:whole-film-brief';
  const sourceFingerprint = sha256Hex(content);
  const sourceRanges = [{ sourceIndex: 0, sourceId, sourceFingerprint, startOffset: 0, endOffset: content.length }];
  const sequence: AuthoredChapterSequence = {
    protocolVersion: 'tapcanvas.chapter-sequence/v4',
    wholeFilmIntent: '一场连续六十秒的对抗，铺垫后逐步升级，技术切点保持正在进行的交锋。',
    totalDurationSeconds: 60,
    storyEvents: [
      { eventId: 'setup', eventIndex: 0, clipId: "clip-1", sceneId: "fight", action: '双方对峙，气流推动碎石。', sourceRanges },
      { eventId: 'engage', eventIndex: 1, clipId: "clip-1", sceneId: "fight", action: '镜头穿过气浪，双方进入高速交锋并沿同一场地推进。', sourceRanges },
      { eventId: 'continuous-strike', eventIndex: 2, clipId: "clip-1", sceneId: "fight", action: '剑影沿弧线压向魔气，双方持续改变受力与距离，最终击穿外层防御。', sourceRanges },
      { eventId: 'climax', eventIndex: 3, clipId: "clip-2", sceneId: "fight", action: '攻势升级为大招对撞，主角击破对手防御。', sourceRanges },
      { eventId: 'ending', eventIndex: 4, clipId: "clip-2", sceneId: "fight", action: '主角落地，余波逐渐消散。', sourceRanges },
    ],
    speechEvents: [],
    boundaries: [
      { boundaryId: 'opening', timeSeconds: 0, keyframe: { visual: '同一战场的两人', state: '双方站立，尚未交手' }, causalEntry: '冲突即将爆发', irreversibleResult: '', handoff: '开始铺垫' },
      { boundaryId: 'in-motion', timeSeconds: 30, keyframe: { visual: '剑锋正沿弧线压入魔气，双方仍向前运动', state: '剑影处于进攻中途，防御外层仍未击穿' }, causalEntry: '接住正在进行的弧线攻势', irreversibleResult: '', handoff: '沿当前速度和受力继续，尚未完成这一击' },
      { boundaryId: 'ending', timeSeconds: 60, keyframe: { visual: '主角落地，碎石沉降', state: '战斗已结束，主角站稳' }, causalEntry: '对撞已经产生结果', irreversibleResult: '对手防御已破', handoff: '全片结束' },
    ],
    clips: [
      { clipId: "clip-1", durationSeconds: 30, storyEventIds: ['setup', 'engage', 'continuous-strike'], speechEventIds: [], startBoundaryId: 'opening', endBoundaryId: 'in-motion' },
      { clipId: "clip-2", durationSeconds: 30, storyEventIds: ['climax', 'ending'], speechEventIds: [], startBoundaryId: 'in-motion', endBoundaryId: 'ending' },
    ],
  };
  const deliveryContract = {
    protocolVersion: '2', executionScope: 'media_delivery', targetDurationSeconds: 60,
    generationContract: { videoModel: 'test-video-model', durationOptions: [30], maxDurationSeconds: 30, clipPlanningPolicy: 'agent_semantic_duration_budget' },
    canvasFacts: { authoritativeSources: [{ sourceId, sourceFingerprint, content }] },
  };
  return { deliveryContract, sequence };
}
