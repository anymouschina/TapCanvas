import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipProductionTimelineDraftSchema, clipTimelineRowLabels, compileClipProductionTimeline, deriveClipTimelineSegments, renderClipSpokenLine } from './timeline.mjs';

const storyEvents = [
  { eventId: 'wait', eventIndex: 0, action: '独坐等待' },
  { eventId: 'arrival', eventIndex: 1, action: '母亲归来' },
];
const speechEvents = [
  { speechEventId: 'line', eventIndex: 1, storyEventId: 'arrival', speaker: '母亲', delivery: '疲惫', text: '回来了？' },
];
const shot = (action, storyEventIds = [], speechEventIds = []) => ({ action, camera: '', sound: '', storyEventIds, speechEventIds });

test('descriptive shots have no per-shot duration, absolute clock or fixed count', () => {
  const schema = clipProductionTimelineDraftSchema.properties.shots;
  assert.equal(schema.maxItems, undefined);
  assert.equal(schema.items.properties.durationSeconds, undefined);
  assert.equal(schema.items.additionalProperties, false);
  assert.deepEqual(schema.items.required, ['action', 'camera', 'sound', 'storyEventIds', 'speechEventIds']);
  for (const count of [1, 3, 8, 18]) {
    const draft = { scene: '雅间', shots: Array.from({ length: count }, (_, index) => shot(`描述${index + 1}`)) };
    const prompt = compileClipProductionTimeline({ draft, storyEvents: [], speechEvents: [] });
    assert.equal(prompt.split('\n').filter((line) => /^镜头\d+：/.test(line)).length, count);
    assert.ok(!/\d+\s*(?:s|秒)|durationSeconds|startSeconds|endSeconds/.test(prompt));
  }
});

test('ordered event IDs preserve frozen facts without prescribing cuts', () => {
  assert.deepEqual(deriveClipTimelineSegments({ storyEvents, speechEvents }), [
    { storyEventIds: ['wait'], speechEventIds: [] },
    { storyEventIds: ['arrival'], speechEventIds: ['line'] },
  ]);
  const shots = [shot('等待', ['wait']), shot('推门', ['arrival'], ['line']), shot('走向桌边', ['arrival'])];
  const segments = deriveClipTimelineSegments({ storyEvents, speechEvents, shots });
  assert.deepEqual(segments, shots.map(({ storyEventIds, speechEventIds }) => ({ storyEventIds, speechEventIds })));
  assert.deepEqual(clipTimelineRowLabels(segments), ['镜头1', '镜头2', '镜头3']);
  const prompt = compileClipProductionTimeline({ draft: { scene: '', shots }, storyEvents, speechEvents });
  assert.equal(prompt, '镜头1：等待\n镜头2：推门；母亲（疲惫）说：“回来了？”\n镜头3：走向桌边');
});

test('a compiler binds speech once and lets the model adapt its performance across cuts', () => {
  const line = { speechEventId: 'voice', eventIndex: 0, speaker: '顾观棋', delivery: '平静自嘲', text: '这一世相亲，总不会还出问题了吧？', voice: 'inner' };
  for (const count of [1, 5]) {
    const shots = Array.from({ length: count }, (_, index) => shot('持续表演', [], index === 0 ? ['voice'] : []));
    const prompt = compileClipProductionTimeline({ draft: { scene: '', shots }, speechEvents: [line] });
    assert.equal(prompt.split('“这一世相亲，总不会还出问题了吧？”').length - 1, 1);
    assert.ok(prompt.includes('顾观棋的内心独白（顾观棋声音，平静自嘲）：'));
    assert.ok(!prompt.includes('不开口'));
    assert.ok(!prompt.includes('这句话一直说到'));
  }
});

test('scene, camera, action, sound notation and complete dialogue stay intact', () => {
  const prompt = compileClipProductionTimeline({
    draft: { scene: '  雨夜药谷\n石阶  ', shots: [{ ...shot('张羽停步', [], ['line']), camera: '低机位缓推', sound: '雨声' }] },
    speechEvents: [{ speechEventId: 'line', eventIndex: 0, speaker: '张羽', delivery: '低声', text: '到了。' }],
  });
  assert.equal(prompt, '【  雨夜药谷\n石阶  】\n镜头1：张羽停步；低机位缓推；音效：雨声；张羽（低声）说：“到了。”');
});

test('only explicit authored scene headings split ordered shots while numbering continues', () => {
  assert.equal(clipProductionTimelineDraftSchema.properties.shots.items.properties.sceneTitle.type, 'string');
  const draft = { scene: '第一场：雅间，白天', shots: [
    shot('独坐桌边'),
    { ...shot('现代斑马线'), sceneTitle: '第二场：回忆，冷白过曝' },
    shot('镜头转回雅间，但作者未写新标题'),
    { ...shot('医馆棋盘'), sceneTitle: '第三场：医馆窗边，午后' },
    { ...shot('抬头望门'), sceneTitle: '回到第一场雅间' },
    { ...shot('静静等待'), sceneTitle: '' },
  ] };
  assert.equal(compileClipProductionTimeline({ draft, speechEvents: [] }),
    '【第一场：雅间，白天】\n镜头1：独坐桌边\n【第二场：回忆，冷白过曝】\n镜头2：现代斑马线\n镜头3：镜头转回雅间，但作者未写新标题\n【第三场：医馆窗边，午后】\n镜头4：医馆棋盘\n【回到第一场雅间】\n镜头5：抬头望门\n镜头6：静静等待');
});

test('task1484-style scene sequence binds whole inner, offscreen and onscreen speech to authored shots', () => {
  const events = ['独坐雅间', '现代斑马线', '车灯扑来', '返回雅间'].map((action, eventIndex) => ({ eventId: `e${eventIndex}`, eventIndex, action }));
  const speech = [
    { speechEventId: 'thought', eventIndex: 0, speaker: '顾观棋', delivery: '平静', voice: 'inner', text: '这一世相亲，总不会还出问题了吧？' },
    { speechEventId: 'memory', eventIndex: 1, speaker: '顾观棋', delivery: '平静', voice: 'offscreen', text: '  上辈子，\n我就死在相亲的路上。  ' },
    { speechEventId: 'greeting', eventIndex: 2, speaker: '顾观棋', delivery: '微笑', voice: 'onscreen', text: '那就见见。' },
  ];
  const draft = { scene: '第一场：百花酒楼二楼雅间，白天', shots: [
    { ...shot('顾观棋独坐红木圆桌旁', ['e0'], ['thought']), camera: '面部近景' },
    { ...shot('年轻男子背影走上斑马线', ['e1'], ['memory']), sceneTitle: '第二场：回忆，冷白过曝' },
    { ...shot('车灯扑来，画面爆白', ['e2']), sound: '刹车声尖啸' },
    { ...shot('顾观棋抬头微笑', ['e3'], ['greeting']), sceneTitle: '回到第一场雅间' },
  ] };
  const prompt = compileClipProductionTimeline({ draft, storyEvents: events, speechEvents: speech });
  assert.equal(prompt,
    '【第一场：百花酒楼二楼雅间，白天】\n镜头1：顾观棋独坐红木圆桌旁；面部近景；顾观棋的内心独白（顾观棋声音，平静）：“这一世相亲，总不会还出问题了吧？”\n'
    + '【第二场：回忆，冷白过曝】\n镜头2：年轻男子背影走上斑马线；顾观棋画外音（平静）：“  上辈子，\n我就死在相亲的路上。  ”\n'
    + '镜头3：车灯扑来，画面爆白；音效：刹车声尖啸\n【回到第一场雅间】\n镜头4：顾观棋抬头微笑；顾观棋（微笑）说：“那就见见。”');
  for (const line of speech) assert.equal(prompt.split(`：“${line.text}”`).length - 1, 1);
  assert.ok(!prompt.includes('无解说旁白'));
});

test('only authored scene and shot facts reach the provider, not presence ledgers or review metadata', () => {
  const events = [{ eventId: 'event-42', eventIndex: 0, action: '内部故事描述', onScreen: ['甲', '系统提示音'],
    sourceRanges: [{ sourceId: 'internal-source' }], provenance: 'internal provenance', reviewNote: 'check continuity',
    staging: [{ who: '甲', mark: 'internal-mark' }] }];
  const line = { speechEventId: 'voice-27', eventIndex: 0, speaker: '系统提示音', delivery: '机械音', text: '评定三星', voice: 'offscreen' };
  const prompt = compileClipProductionTimeline({
    draft: { scene: '木门前', shots: [shot('两女跨过门槛进入雅间，金色面板显示“三星”。', ['event-42'], ['voice-27'])] },
    storyEvents: events, speechEvents: [line],
  });
  assert.equal(prompt, '【木门前】\n镜头1：两女跨过门槛进入雅间，金色面板显示“三星”。；系统提示音画外音（机械音）：“评定三星”');
  for (const internal of ['人物：', '这 2 个人', '全段没有人', '开场站位：', 'internal-source', 'internal-mark', 'event-42', 'voice-27', 'check continuity', 'internal provenance', '无画面文字', '不开口', '句台词']) {
    assert.ok(!prompt.includes(internal), internal);
  }
  assert.ok(!prompt.includes('无解说旁白'));
});

test('structural reference errors fail explicitly without inferred ownership or timing', () => {
  const base = { storyEvents, speechEvents };
  assert.throws(() => deriveClipTimelineSegments({ ...base, shots: [shot('a', ['wait'])] }), /every frozen storyEventId/);
  assert.throws(() => deriveClipTimelineSegments({ ...base, shots: [shot('a', ['wait', 'arrival'])] }), /every frozen speechEventId/);
  assert.throws(() => deriveClipTimelineSegments({ ...base, shots: [shot('a', ['arrival', 'wait'], ['line'])] }), /in order/);
  assert.throws(() => deriveClipTimelineSegments({ ...base, shots: [shot('a', ['wait', 'arrival'], ['line']), shot('b', [], ['line'])] }), /once in order/);
  assert.throws(() => deriveClipTimelineSegments({ ...base, shots: [shot('a', ['unknown'], ['line'])] }), /frozen story events/);
  assert.throws(() => compileClipProductionTimeline({ draft: { scene: '', shots: [{ ...shot('a'), durationSeconds: 2 }] }, speechEvents: [] }), /invalid descriptive fields/);
  assert.throws(() => compileClipProductionTimeline({ draft: { scene: '', shots: [{ ...shot('a'), sceneTitle: 3 }] }, speechEvents: [] }), /invalid descriptive fields/);
});

test('local voice categories preserve complete dialogue in Chinese quotes', () => {
  assert.equal(renderClipSpokenLine({ speaker: '林嫣儿', delivery: '客气', text: '久等了。', voice: 'onscreen' }), '林嫣儿（客气）说：“久等了。”');
  assert.equal(renderClipSpokenLine({ speaker: '相亲系统', delivery: '机械音', text: '【评定三星】', voice: 'offscreen' }), '相亲系统画外音（机械音）：“【评定三星】”');
  assert.equal(renderClipSpokenLine({ speaker: '讲述者甲', delivery: '沉稳', text: '门外响起敲门声。', voice: 'narration' }), '讲述者甲旁白（沉稳）：“门外响起敲门声。”');
});

test('shot blocks separate action and multiple voices without changing authored text or delivery', () => {
  const lines = [
    { speechEventId: 'a', eventIndex: 0, speaker: '甲', delivery: '走近，压低声音',
      voice: 'onscreen', text: '  原话，\r\n说：{照读}。\u2028继续\u2029  ' },
    { speechEventId: 'b', eventIndex: 1, speaker: '乙', delivery: '  停顿\n接话  ',
      voice: 'inner', text: '\n不删最后的逗号， ' },
    { speechEventId: 'c', eventIndex: 2, speaker: '讲述者', delivery: '',
      voice: 'narration', text: '结尾也不补标点' },
  ];
  const draft = { scene: ' 室内\n门边 ', shots: [
    { ...shot('  甲靠近，\n乙转头，  ', [], ['a', 'b', 'c']), camera: ' 横移\n停住 ', sound: '<撞击>\r\n纸页摩擦' },
    { ...shot('静静等待'), camera: '  \n ', sound: '\t' },
  ] };
  const before = structuredClone({ draft, lines });
  const prompt = compileClipProductionTimeline({ draft, speechEvents: lines });
  assert.equal(prompt, `【${draft.scene}】\n镜头1：${draft.shots[0].action}；${draft.shots[0].camera}；音效：${draft.shots[0].sound}；甲（${lines[0].delivery}）说：“${lines[0].text}”；乙的内心独白（乙声音，${lines[1].delivery}）：“${lines[1].text}”；讲述者旁白：“${lines[2].text}”\n镜头2：静静等待`);
  assert.deepEqual({ draft, lines }, before);
  for (const line of lines) assert.equal(prompt.split(`：“${line.text}”`).length - 1, 1);
  assert.ok(!prompt.includes('无对白'));
  assert.equal(renderClipSpokenLine({ speaker: '甲', delivery: ' \n', text: '是。' }), '甲说：“是。”');
});

test('the 18-shot descriptive reference preserves ordered action and whole introduction dialogue', () => {
  const actions = ['木门传来敲门声', '顾观棋起身拉开木门', '走廊两女并肩而立', '林嫣儿一笑', '沈清秋目光沉锐', '顾观棋看向沈清秋',
    '顾观棋拱手见礼', '林嫣儿欠身行礼', '顾观棋作揖', '林嫣儿挽住沈清秋手臂', '沈清秋微微颔首', '顾观棋眼神一凝',
    '顾观棋连忙拱手', '顾观棋侧身让开门口', '顾观棋转向沈清秋', '沈清秋抱拳', '两女走进雅间', '林嫣儿抬手打断'];
  const events = actions.map((action, eventIndex) => ({ eventId: `event-${eventIndex}`, eventIndex, action }));
  const introduction = '这位是我的闺中密友沈清秋沈姐姐，青阳郡六扇门百户。';
  const lines = [
    { speechEventId: 'greeting', eventIndex: 6, storyEventId: 'event-6', speaker: '顾观棋', delivery: '拱手', text: '在下顾观棋，请问二位？' },
    { speechEventId: 'introduction', eventIndex: 9, storyEventId: 'event-9', speaker: '林嫣儿', delivery: '笑着介绍', text: introduction },
    { speechEventId: 'interruption', eventIndex: 17, storyEventId: 'event-17', speaker: '林嫣儿', delivery: '急忙', text: '不用上菜了！' },
  ];
  const shots = actions.map((action, index) => shot(action, [`event-${index}`], lines.filter((line) => line.eventIndex === index).map((line) => line.speechEventId)));
  const prompt = compileClipProductionTimeline({ draft: { scene: '百花酒楼二楼雅间，木门通往走廊', shots }, storyEvents: events, speechEvents: lines });
  assert.equal(prompt.split('\n').filter((line) => /^镜头\d+：/.test(line)).length, 18);
  assert.ok(prompt.includes(`镜头10：林嫣儿挽住沈清秋手臂；林嫣儿（笑着介绍）说：“${introduction}”`));
  assert.equal(prompt.split(introduction).length - 1, 1);
  assert.ok(prompt.includes('镜头18：林嫣儿抬手打断；林嫣儿（急忙）说：“不用上菜了！”'));
  assert.ok(!/\d+\s*(?:s|秒)|durationSeconds|startSeconds|endSeconds/.test(prompt));
});
