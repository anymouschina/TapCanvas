export type TemporalFrameWindow = Readonly<{
  /** Zero-based physical order inside one Clip. */
  windowIndex: number;
  /** Clip-local inclusive time. */
  startSeconds: number;
  /** Clip-local exclusive time; every window is at most one second. */
  endSeconds: number;
  /** Frozen machine-relay state at the beginning of this window. */
  startState: string;
  /** Executable visual description of the opening frame. */
  startFrame: string;
  /** Visible driver/path/contact/reaction connecting the two frame states. */
  transition: string;
  /** Executable visual description of the carried frame. */
  carryFrame: string;
  /** Frozen machine-relay state carried into the next window. */
  carryState: string;
  /** Frozen story events whose time intervals intersect this window. */
  storyEventIndices: readonly number[];
}>;

export type TemporalFrameCoverage = Readonly<{
  windowIndex: number;
  shotNos: readonly number[];
}>;

export type SourceEventCoverage = Readonly<{
  storyEventIndex: number;
  shotNos: readonly number[];
}>;

type JsonRecord = Record<string, unknown>;

type StoryEventInterval = Readonly<{
  startSeconds: number;
  endSeconds: number;
  entryState: string;
  exitState: string;
}>;

type ShotInterval = Readonly<{
  shotNo: number;
  startSeconds: number;
  endSeconds: number;
}>;

type ExecutableShotInterval = ShotInterval & Readonly<{
  visualTask: string;
  action: string;
  depictedStoryEventIndices: readonly number[];
}>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function exactSecond(value: number): number {
  return Number(value.toFixed(6));
}

function parseStoryEventIntervals(value: readonly unknown[], field: string): StoryEventInterval[] {
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`${field}[${index}] must be an object`);
    const startSeconds = raw.startSeconds;
    const endSeconds = raw.endSeconds;
    const entryState = readString(raw.entryState);
    const exitState = readString(raw.exitState);
    if (
      typeof startSeconds !== "number"
      || typeof endSeconds !== "number"
      || !Number.isFinite(startSeconds)
      || !Number.isFinite(endSeconds)
      || endSeconds <= startSeconds
      || !entryState
      || !exitState
    ) {
      throw new Error(`${field}[${index}] requires a positive interval and non-empty entryState/exitState`);
    }
    return { startSeconds, endSeconds, entryState, exitState };
  });
}

function expectedEventIndices(
  window: Pick<TemporalFrameWindow, "startSeconds" | "endSeconds">,
  events: readonly StoryEventInterval[],
): number[] {
  return events.flatMap((event, index) => (
    event.startSeconds < window.endSeconds && event.endSeconds > window.startSeconds ? [index] : []
  ));
}

function parseExecutableShotIntervals(
  shots: unknown,
  durationSeconds: number,
  events: readonly StoryEventInterval[],
  field: string,
): ExecutableShotInterval[] {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error(`${field} requires non-empty shots`);
  let cursor = 0;
  const intervals = shots.map((raw, index): ExecutableShotInterval => {
    if (!isRecord(raw)) throw new Error(`${field}.shots[${index}] must be an object`);
    const duration = raw.durationSeconds;
    const visualTask = readString(raw.visualTask);
    const action = readString(raw.action) || visualTask;
    const depictedStoryEventIndices = raw.depictedStoryEventIndices;
    if (
      raw.shotNo !== index + 1
      || typeof duration !== "number"
      || !Number.isFinite(duration)
      || duration <= 0
      || !visualTask
    ) {
      throw new Error(
        `${field}.shots[${index}] requires sequential shotNo, positive durationSeconds and visualTask`,
      );
    }
    if (!Array.isArray(depictedStoryEventIndices) || depictedStoryEventIndices.length === 0) {
      throw new Error(`${field}.shots[${index}].depictedStoryEventIndices must be a non-empty array`);
    }
    const declaredIndices = depictedStoryEventIndices.map((value, eventIndex) => {
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= events.length) {
        throw new Error(
          `${field}.shots[${index}].depictedStoryEventIndices[${eventIndex}] must reference an existing storyEvent`,
        );
      }
      return Number(value);
    });
    if (declaredIndices.some((value, eventIndex) => eventIndex > 0 && declaredIndices[eventIndex - 1] >= value)) {
      throw new Error(`${field}.shots[${index}].depictedStoryEventIndices must be strictly ascending and unique`);
    }
    const startSeconds = exactSecond(cursor);
    cursor = exactSecond(cursor + duration);
    for (const storyEventIndex of declaredIndices) {
      const event = events[storyEventIndex];
      if (!event || startSeconds >= event.endSeconds || cursor <= event.startSeconds) {
        throw new Error(
          `${field}.shots[${index}].depictedStoryEventIndices declares storyEvent ${storyEventIndex} outside the shot clock interval`,
        );
      }
    }
    return {
      shotNo: index + 1,
      startSeconds,
      endSeconds: cursor,
      visualTask,
      action,
      depictedStoryEventIndices: declaredIndices,
    };
  });
  if (cursor !== exactSecond(durationSeconds)) {
    throw new Error(`${field}.shots duration sum must equal durationSeconds`);
  }
  let previousFirstEventIndex = -1;
  for (const [shotIndex, shot] of intervals.entries()) {
    const firstEventIndex = shot.depictedStoryEventIndices[0];
    if (firstEventIndex === undefined) {
      throw new Error(`${field}.shots[${shotIndex}].depictedStoryEventIndices must be non-empty`);
    }
    if (firstEventIndex < previousFirstEventIndex) {
      throw new Error(`${field}.shots must preserve frozen storyEvent order`);
    }
    previousFirstEventIndex = firstEventIndex;
  }
  return intervals;
}

function stateAtBoundary(
  seconds: number,
  events: readonly StoryEventInterval[],
  field: string,
): string {
  const ending = events.find((event) => exactSecond(event.endSeconds) === seconds);
  if (ending) return ending.exitState;
  const starting = events.find((event) => exactSecond(event.startSeconds) === seconds);
  if (starting) return starting.entryState;
  const active = events.find((event) => event.startSeconds < seconds && event.endSeconds > seconds);
  if (active) return active.entryState;
  throw new Error(`${field} has no frozen story state at ${seconds}s`);
}

/**
 * Compile all machine-owned time fields and the writer-declared event-reference
 * projection from already-authored shots plus the caller-frozen story-event
 * ledger. The compiler copies visual
 * prose verbatim from visualTask/action and never interprets or invents story
 * semantics. A static shot may omit action; in that case its visualTask is
 * reused verbatim as the visible transition. Integer seconds, story boundaries and shot boundaries form the
 * only clock partition, so every window is deterministic and at most one
 * second long.
 */
export function compileTemporalFrameContract(input: Readonly<{
  durationSeconds: number;
  storyEvents: readonly unknown[];
  exitState: string;
  shots: unknown;
  field: string;
}>): Readonly<{
  temporalFrameTrack: readonly TemporalFrameWindow[];
  temporalFrameCoverage: readonly TemporalFrameCoverage[];
  sourceEventCoverage: readonly SourceEventCoverage[];
}> {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error(`${input.field}.durationSeconds must be positive`);
  }
  const durationSeconds = exactSecond(input.durationSeconds);
  const events = parseStoryEventIntervals(input.storyEvents, `${input.field}.storyEvents`);
  if (events.length === 0) throw new Error(`${input.field}.storyEvents must be non-empty`);
  const shots = parseExecutableShotIntervals(input.shots, durationSeconds, events, input.field);
  const boundaries = new Set<number>([0, durationSeconds]);
  for (let second = 1; second < durationSeconds; second += 1) boundaries.add(exactSecond(second));
  events.forEach((event) => {
    boundaries.add(exactSecond(event.startSeconds));
    boundaries.add(exactSecond(event.endSeconds));
  });
  shots.forEach((shot) => {
    boundaries.add(shot.startSeconds);
    boundaries.add(shot.endSeconds);
  });
  const orderedBoundaries = [...boundaries]
    .filter((seconds) => seconds >= 0 && seconds <= durationSeconds)
    .sort((left, right) => left - right);
  const temporalFrameTrack = orderedBoundaries.slice(0, -1).map((startSeconds, windowIndex): TemporalFrameWindow => {
    const endSeconds = orderedBoundaries[windowIndex + 1];
    if (endSeconds === undefined || endSeconds <= startSeconds || exactSecond(endSeconds - startSeconds) > 1) {
      throw new Error(`${input.field} cannot compile a positive one-second-or-shorter window at ${startSeconds}s`);
    }
    const intersectingShots = shots.filter((shot) => (
      shot.startSeconds < endSeconds && shot.endSeconds > startSeconds
    ));
    const firstShot = intersectingShots[0];
    const lastShot = intersectingShots.at(-1);
    if (!firstShot || !lastShot) throw new Error(`${input.field} has no shot covering ${startSeconds}-${endSeconds}s`);
    return {
      windowIndex,
      startSeconds,
      endSeconds,
      startState: stateAtBoundary(startSeconds, events, input.field),
      startFrame: firstShot.visualTask,
      transition: [...new Set(intersectingShots.map((shot) => shot.action))].join("；"),
      carryFrame: lastShot.visualTask,
      carryState: stateAtBoundary(endSeconds, events, input.field),
      storyEventIndices: expectedEventIndices({ startSeconds, endSeconds }, events),
    };
  });
  const temporalFrameCoverage = temporalFrameTrack.map((window): TemporalFrameCoverage => ({
    windowIndex: window.windowIndex,
    shotNos: shots
      .filter((shot) => shot.startSeconds < window.endSeconds && shot.endSeconds > window.startSeconds)
      .map((shot) => shot.shotNo),
  }));
  const sourceEventCoverage = events.map((_event, storyEventIndex): SourceEventCoverage => ({
    storyEventIndex,
    shotNos: shots
      .filter((shot) => shot.depictedStoryEventIndices.includes(storyEventIndex))
      .map((shot) => shot.shotNo),
  }));
  const validatedTrack = parseTemporalFrameTrack({
    value: temporalFrameTrack,
    durationSeconds,
    storyEvents: input.storyEvents,
    exitState: input.exitState,
    field: `${input.field}.temporalFrameTrack`,
  });
  validateTemporalFrameCoverage({
    coverage: temporalFrameCoverage,
    track: validatedTrack,
    shots: input.shots,
    field: `${input.field}.temporalFrameCoverage`,
  });
  if (sourceEventCoverage.some((coverage) => coverage.shotNos.length === 0)) {
    throw new Error(`${input.field}.sourceEventCoverage cannot leave a frozen story event unmapped`);
  }
  return { temporalFrameTrack: validatedTrack, temporalFrameCoverage, sourceEventCoverage };
}

/**
 * Parse the deterministic time-resolution contract used by BeatSheet, writer,
 * reviewer and the final execution renderer. This validates only clock/state
 * relay structure; it never judges prose style or semantic quality.
 */
export function parseTemporalFrameTrack(input: Readonly<{
  value: unknown;
  durationSeconds: number;
  storyEvents: readonly unknown[];
  exitState: string;
  field: string;
}>): TemporalFrameWindow[] {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error(`${input.field} requires a positive durationSeconds`);
  }
  if (!Array.isArray(input.value)) throw new Error(`${input.field} must be an array`);
  const minimumWindowCount = Math.ceil(input.durationSeconds);
  if (input.value.length < minimumWindowCount) {
    throw new Error(`${input.field} must contain at least ${minimumWindowCount} one-second-or-shorter windows`);
  }
  const events = parseStoryEventIntervals(input.storyEvents, `${input.field}.storyEvents`);
  if (events.length === 0) throw new Error(`${input.field} requires non-empty storyEvents`);

  let previousEndSeconds = 0;
  const windows = input.value.map((raw, index): TemporalFrameWindow => {
    if (!isRecord(raw)) throw new Error(`${input.field}[${index}] must be an object`);
    if (raw.windowIndex !== index) {
      throw new Error(`${input.field}[${index}].windowIndex must equal ${index}`);
    }
    if (
      typeof raw.startSeconds !== "number"
      || typeof raw.endSeconds !== "number"
      || !Number.isFinite(raw.startSeconds)
      || !Number.isFinite(raw.endSeconds)
    ) {
      throw new Error(`${input.field}[${index}] requires finite startSeconds/endSeconds`);
    }
    const startSeconds = exactSecond(raw.startSeconds);
    const endSeconds = exactSecond(raw.endSeconds);
    if (
      startSeconds !== previousEndSeconds
      || endSeconds <= startSeconds
      || exactSecond(endSeconds - startSeconds) > 1
      || endSeconds > exactSecond(input.durationSeconds)
    ) {
      throw new Error(
        `${input.field}[${index}] must continue at ${previousEndSeconds}s with a positive interval no longer than 1s`,
      );
    }
    const startState = readString(raw.startState);
    const startFrame = readString(raw.startFrame);
    const transition = readString(raw.transition);
    const carryFrame = readString(raw.carryFrame);
    const carryState = readString(raw.carryState);
    if (!startState || !startFrame || !transition || !carryFrame || !carryState) {
      throw new Error(
        `${input.field}[${index}] requires non-empty startState, startFrame, transition, carryFrame and carryState`,
      );
    }
    if (!Array.isArray(raw.storyEventIndices)) {
      throw new Error(`${input.field}[${index}].storyEventIndices must be an array`);
    }
    const storyEventIndices = raw.storyEventIndices.map(Number);
    const expectedIndices = expectedEventIndices({ startSeconds, endSeconds }, events);
    if (
      storyEventIndices.some((eventIndex) => !Number.isInteger(eventIndex) || eventIndex < 0)
      || JSON.stringify(storyEventIndices) !== JSON.stringify(expectedIndices)
    ) {
      throw new Error(
        `${input.field}[${index}].storyEventIndices must exactly equal intersecting events ${JSON.stringify(expectedIndices)}`,
      );
    }
    const window: TemporalFrameWindow = {
      windowIndex: index,
      startSeconds,
      endSeconds,
      startState,
      startFrame,
      transition,
      carryFrame,
      carryState,
      storyEventIndices,
    };
    previousEndSeconds = endSeconds;
    return window;
  });

  if (previousEndSeconds !== exactSecond(input.durationSeconds)) {
    throw new Error(`${input.field} final endSeconds must equal durationSeconds`);
  }

  const firstEvent = events[0];
  if (windows[0]?.startState !== firstEvent?.entryState) {
    throw new Error(`${input.field}[0].startState must equal the first storyEvent entryState`);
  }
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index]?.startState !== windows[index - 1]?.carryState) {
      throw new Error(`${input.field}[${index}].startState must exactly equal the previous carryState`);
    }
  }
  if (windows.at(-1)?.carryState !== input.exitState) {
    throw new Error(`${input.field} final carryState must equal the frozen Clip exitState`);
  }

  for (const event of events) {
    const eventStart = exactSecond(event.startSeconds);
    const eventEnd = exactSecond(event.endSeconds);
    const startWindow = windows.find((window) => window.startSeconds === eventStart);
    if (!startWindow || startWindow.startState !== event.entryState) {
      throw new Error(`${input.field} must preserve the storyEvent boundary at ${eventStart}s and its entryState`);
    }
    const endWindow = windows.find((window) => window.endSeconds === eventEnd);
    if (!endWindow || endWindow.carryState !== event.exitState) {
      throw new Error(`${input.field} must preserve the storyEvent boundary at ${eventEnd}s and its exitState`);
    }
  }
  return windows;
}

export function assertExactTemporalFrameTrack(input: Readonly<{
  actual: unknown;
  expected: readonly TemporalFrameWindow[];
  durationSeconds: number;
  storyEvents: readonly unknown[];
  exitState: string;
  field: string;
}>): TemporalFrameWindow[] {
  const actual = parseTemporalFrameTrack({
    value: input.actual,
    durationSeconds: input.durationSeconds,
    storyEvents: input.storyEvents,
    exitState: input.exitState,
    field: input.field,
  });
  if (JSON.stringify(actual) !== JSON.stringify(input.expected)) {
    throw new Error(`${input.field} must preserve the frozen BeatSheet temporal frame track exactly`);
  }
  return actual;
}

function parseShotIntervals(shots: unknown, field: string): ShotInterval[] {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error(`${field} requires non-empty shots`);
  let cursor = 0;
  return shots.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`${field}.shots[${index}] must be an object`);
    const shotNo = raw.shotNo;
    const durationSeconds = raw.durationSeconds;
    if (
      shotNo !== index + 1
      || typeof durationSeconds !== "number"
      || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0
    ) {
      throw new Error(`${field}.shots[${index}] requires sequential shotNo and positive durationSeconds`);
    }
    const startSeconds = exactSecond(cursor);
    cursor = exactSecond(cursor + durationSeconds);
    return { shotNo, startSeconds, endSeconds: cursor };
  });
}

export function validateTemporalFrameCoverage(input: Readonly<{
  coverage: unknown;
  track: readonly TemporalFrameWindow[];
  shots: unknown;
  field: string;
}>): TemporalFrameCoverage[] {
  if (!Array.isArray(input.coverage) || input.coverage.length !== input.track.length) {
    throw new Error(`${input.field} must contain exactly one entry for every temporal frame window`);
  }
  const shots = parseShotIntervals(input.shots, input.field);
  const usedShotNos = new Set<number>();
  const coverage = input.coverage.map((raw, index): TemporalFrameCoverage => {
    if (!isRecord(raw) || raw.windowIndex !== index || !Array.isArray(raw.shotNos) || raw.shotNos.length === 0) {
      throw new Error(`${input.field}[${index}] requires windowIndex=${index} and non-empty shotNos`);
    }
    const shotNos = raw.shotNos.map(Number);
    if (new Set(shotNos).size !== shotNos.length) {
      throw new Error(`${input.field}[${index}].shotNos must not contain duplicates`);
    }
    const window = input.track[index];
    const invalid = shotNos.some((shotNo) => {
      const shot = shots.find((candidate) => candidate.shotNo === shotNo);
      if (!shot || !window) return true;
      return !(shot.startSeconds < window.endSeconds && shot.endSeconds > window.startSeconds);
    });
    if (invalid) {
      throw new Error(`${input.field}[${index}].shotNos must reference real shots intersecting this time window`);
    }
    shotNos.forEach((shotNo) => usedShotNos.add(shotNo));
    return { windowIndex: index, shotNos };
  });
  const untrackedShots = shots.filter((shot) => !usedShotNos.has(shot.shotNo)).map((shot) => shot.shotNo);
  if (untrackedShots.length > 0) {
    throw new Error(`${input.field} must map every real shot; missing=${JSON.stringify(untrackedShots)}`);
  }
  return coverage;
}
