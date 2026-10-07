export const clipProductionTimelineDraftSchema = {
  type: 'object',
  description: 'Ordered descriptive shots bound to frozen story and speech events. The provider request owns Clip duration.',
  properties: {
    scene: { type: 'string', description: 'Initial scene heading and stable facts, rendered once as 【scene】 before the shots. Empty when no heading is needed.' },
    shots: {
      type: 'array', minItems: 1,
      description: 'Author-chosen ordered shots; no per-shot clock.',
      items: {
        type: 'object',
        properties: {
          sceneTitle: { type: 'string', description: 'Optional scene heading rendered as 【sceneTitle】 immediately before this shot.' },
          action: { type: 'string', minLength: 1, description: 'The visible progression; preserved without host rewriting.' },
          camera: { type: 'string', description: 'Framing or camera movement; empty when unchanged.' },
          sound: { type: 'string', description: 'Authored sound direction; empty when none. Spoken lines are bound by speechEventIds.' },
          storyEventIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true, description: 'Frozen story events depicted in this shot, in story order. An event may continue across shots.' },
          speechEventIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true, description: 'Whole frozen spoken lines that begin here, in speech order. Each line appears in exactly one shot; its timing is adapted by the video model.' },
        },
        required: ['action', 'camera', 'sound', 'storyEventIds', 'speechEventIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['scene', 'shots'], additionalProperties: false,
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEvents(events, idField, label) {
  if (!Array.isArray(events)) throw new Error(`${label} must be an array`);
  const seen = new Set();
  return events.map((event, index) => {
    if (!isRecord(event) || typeof event[idField] !== 'string' || !event[idField].trim()
      || !Number.isSafeInteger(event.eventIndex) || event.eventIndex < 0 || seen.has(event[idField])) {
      throw new Error(`${label}[${index}] has invalid ordered event identity`);
    }
    seen.add(event[idField]);
    return event;
  }).sort((left, right) => left.eventIndex - right.eventIndex);
}

function readIds(value, label) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(value).size !== value.length) throw new Error(`${label} must contain unique event IDs`);
  return value;
}

/** Ordered fact groups, with no clock and no inferred shot count or timing. */
export function deriveClipTimelineSegments(input) {
  const story = readEvents(input.storyEvents, 'eventId', 'clip-sequence.storyEvents');
  const speech = readEvents(input.speechEvents, 'speechEventId', 'clip-sequence.speechEvents');
  if (input.shots === undefined) {
    return story.map((event) => ({ storyEventIds: [event.eventId],
      speechEventIds: speech.filter((line) => line.storyEventId === event.eventId).map((line) => line.speechEventId) }));
  }
  if (!Array.isArray(input.shots) || input.shots.length === 0) throw new Error('Clip production videoPrompt.shots must contain ordered authored shots');
  const storyOrder = new Map(story.map((event, index) => [event.eventId, index]));
  const speechOrder = new Map(speech.map((event, index) => [event.speechEventId, index]));
  const emittedStory = new Set();
  const emittedSpeech = new Set();
  let latestStory = -1;
  let latestSpeech = -1;
  const segments = input.shots.map((shot, index) => {
    if (!isRecord(shot)) throw new Error(`Clip production videoPrompt.shots[${index}] must be an object`);
    const storyEventIds = readIds(shot.storyEventIds, `shots[${index}].storyEventIds`);
    const speechEventIds = readIds(shot.speechEventIds, `shots[${index}].speechEventIds`);
    for (const id of storyEventIds) {
      const order = storyOrder.get(id);
      if (order === undefined || order < latestStory) throw new Error(`shots[${index}].storyEventIds must reference frozen story events in order`);
      latestStory = order;
      emittedStory.add(id);
    }
    for (const id of speechEventIds) {
      const order = speechOrder.get(id);
      if (order === undefined || order < latestSpeech || emittedSpeech.has(id)) throw new Error(`shots[${index}].speechEventIds must reference each frozen line once in order`);
      latestSpeech = order;
      emittedSpeech.add(id);
    }
    return { storyEventIds, speechEventIds };
  });
  if (emittedStory.size !== story.length) throw new Error('Clip production shots must reference every frozen storyEventId');
  if (emittedSpeech.size !== speech.length) throw new Error('Clip production shots must reference every frozen speechEventId exactly once');
  return segments;
}

export function clipTimelineRowLabels(shots) {
  return shots.map((_shot, index) => `镜头${index + 1}`);
}

/** Render authored speech in the shot's prose, preserving the complete text inside Chinese quotes. */
export function renderClipSpokenLine(event) {
  const delivery = event.delivery.trim() ? event.delivery : '';
  if (event.voice === 'inner') return `${event.speaker}的内心独白（${event.speaker}声音${delivery ? `，${delivery}` : ''}）：“${event.text}”`;
  if (event.voice === 'offscreen') return `${event.speaker}画外音${delivery ? `（${delivery}）` : ''}：“${event.text}”`;
  if (event.voice === 'narration') return `${event.speaker}旁白${delivery ? `（${delivery}）` : ''}：“${event.text}”`;
  return `${event.speaker}${delivery ? `（${delivery}）` : ''}说：“${event.text}”`;
}

/** Compile authored descriptive shots and exact frozen facts without allocating time. */
export function compileClipProductionTimeline(input) {
  const { draft, speechEvents, storyEvents = [] } = input;
  if (!isRecord(draft) || typeof draft.scene !== 'string' || !Array.isArray(draft.shots) || draft.shots.length === 0) {
    throw new Error('Clip production videoPrompt must contain scene and ordered shots');
  }
  const shots = draft.shots.map((value, index) => {
    if (!isRecord(value) || Object.keys(value).some((key) => !['sceneTitle', 'action', 'camera', 'sound', 'storyEventIds', 'speechEventIds'].includes(key))
      || (value.sceneTitle !== undefined && typeof value.sceneTitle !== 'string')
      || typeof value.action !== 'string' || !value.action.trim() || typeof value.camera !== 'string' || typeof value.sound !== 'string') {
      throw new Error(`Clip production videoPrompt.shots[${index}] has invalid descriptive fields`);
    }
    return value;
  });
  const segments = deriveClipTimelineSegments({ storyEvents, speechEvents, shots });
  const speech = readEvents(speechEvents, 'speechEventId', 'Clip production speechEvents');
  const speechById = new Map(speech.map((event) => {
    if (typeof event.speaker !== 'string' || typeof event.delivery !== 'string' || typeof event.text !== 'string') throw new Error('Clip production speechEvents has invalid text');
    return [event.speechEventId, event];
  }));
  const labels = clipTimelineRowLabels(shots);
  const lines = shots.map((shot, index) => {
    const content = [
      shot.action,
      ...(shot.camera.trim() ? [shot.camera] : []),
      ...(shot.sound.trim() ? [`音效：${shot.sound}`] : []),
      ...segments[index].speechEventIds.map((id) => renderClipSpokenLine(speechById.get(id))),
    ].join('；');
    return [...(shot.sceneTitle?.trim() ? [`【${shot.sceneTitle}】`] : []), `${labels[index]}：${content}`].join('\n');
  });
  return [...(draft.scene.trim() ? [`【${draft.scene}】`] : []), ...lines].join('\n');
}
