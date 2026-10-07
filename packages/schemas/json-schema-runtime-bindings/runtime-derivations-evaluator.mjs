const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function dataValuesAtPath(value, path, currentPath, issues) {
  const visit = (current, index, renderedPath) => {
    if (index === path.length) return [current];
    const segment = path[index];
    if (segment === '*') {
      if (!Array.isArray(current)) {
        issues.push({ path: renderedPath, message: 'Runtime derivation expected an array input' });
        return [];
      }
      return current.flatMap((item, itemIndex) => visit(item, index + 1, `${renderedPath}[${itemIndex}]`));
    }
    if (!isRecord(current) || !hasOwn(current, segment)) {
      issues.push({ path: `${renderedPath}.${segment}`, message: 'Runtime derivation input is missing' });
      return [];
    }
    return visit(current[segment], index + 1, `${renderedPath}.${segment}`);
  };
  return visit(value, 0, currentPath);
}

function readCollection(root, path, label, issues) {
  const values = dataValuesAtPath(root, path, '$', issues);
  if (values.length !== 1 || !Array.isArray(values[0])) {
    issues.push({ path: label, message: 'Runtime derivation collection input must resolve to one array' });
    return null;
  }
  return values[0];
}

function dataObjectPath(segments) {
  return segments.reduce((path, segment) => `${path}[${JSON.stringify(segment)}]`, '$');
}

const DERIVED_EXPECTED_PREVIEW_CHARS = 120;

/**
 * 派生值冲突只说「冲突」时，模型无从得知该怎么办（实测同一执行连续多轮重复 storyEventIds 冲突，
 * 每轮重发 3~7 万 token 上下文）。信息保留原有前半句，并追加：该字段由运行时拥有，应从候选中省略
 * （作者 schema 本就不含它），以及运行时推导出的期望值。不改变「冲突如实上报、不覆盖作者候选」的语义。
 */
export function describeDerivedValueConflict(expected) {
  let preview = '';
  try { preview = JSON.stringify(expected) ?? ''; } catch { preview = ''; }
  if (preview.length > DERIVED_EXPECTED_PREVIEW_CHARS) preview = `${preview.slice(0, DERIVED_EXPECTED_PREVIEW_CHARS)}…`;
  return 'Candidate value conflicts with the runtime-derived value'
    + `${preview ? ` (derived: ${preview})` : ''}. This field is runtime-owned: omit it from the candidate instead of editing it; the host derives it from your authored content.`;
}

function setDerivedValue(target, field, expected, path, issues) {
  if (!isRecord(target)) {
    issues.push({ path, message: 'Runtime derivation target must be an object' });
    return;
  }
  if (hasOwn(target, field)) {
    if (!deepEqual(target[field], expected)) issues.push({ path: `${path}[${JSON.stringify(field)}]`, message: describeDerivedValueConflict(expected) });
    return;
  }
  setOwn(target, field, expected);
}

function readNumber(value, path, issues) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, message: 'Runtime derivation input must be a finite number' });
    return null;
  }
  return value;
}

function applySum(root, derivation, issues) {
  const previousIssueCount = issues.length;
  const values = dataValuesAtPath(root, derivation.valuesPath, '$', issues);
  if (issues.length !== previousIssueCount) return;
  let total = 0;
  for (const [index, value] of values.entries()) {
    const number = readNumber(value, `${derivation.valuesPath.join('.')}.value[${index}]`, issues);
    if (number === null) return;
    total += number;
    if (!Number.isFinite(total)) {
      issues.push({ path: derivation.outputPath.join('.'), message: 'Runtime derivation sum is not finite' });
      return;
    }
  }
  setPathValue(root, derivation.outputPath, total, issues);
}

function applyPrefixSums(root, derivation, issues) {
  const previousIssueCount = issues.length;
  const values = dataValuesAtPath(root, derivation.valuesPath, '$', issues);
  if (issues.length !== previousIssueCount) return;
  const totals = [derivation.initial];
  let total = derivation.initial;
  for (const [index, value] of values.entries()) {
    const number = readNumber(value, `${derivation.valuesPath.join('.')}.value[${index}]`, issues);
    if (number === null) return;
    total += number;
    if (!Number.isFinite(total)) {
      issues.push({ path: derivation.outputPath.join('.'), message: 'Runtime derivation prefix sum is not finite' });
      return;
    }
    totals.push(total);
  }
  if (!derivation.includeTerminal) totals.pop();
  const sourceName = derivation.valuesPath.filter(segment => segment !== '*').join('.');
  setArrayPathValues(root, derivation.outputPath, totals, issues,
    `derived from ${sourceName}: ${values.length} item${values.length === 1 ? '' : 's'}${derivation.includeTerminal ? ' plus one terminal entry' : ''}`);
}

function applyIndexReference(root, derivation, issues) {
  const targets = readCollection(root, derivation.targetPath, derivation.targetPath.join('.'), issues);
  const sources = readCollection(root, derivation.sourcePath, derivation.sourcePath.join('.'), issues);
  if (!targets || !sources) return;
  for (let index = 0; index < targets.length; index += 1) {
    const sourceIndex = index + derivation.offset;
    const path = `${dataObjectPath(derivation.targetPath)}[${index}]`;
    if (sourceIndex < 0 || sourceIndex >= sources.length) {
      issues.push({ path: `${path}.${derivation.outputField}`, message: 'Runtime derivation source index is out of bounds' });
      continue;
    }
    const source = sources[sourceIndex];
    if (!isRecord(source) || typeof source[derivation.sourceIdField] !== 'string') {
      issues.push({ path: `${derivation.sourcePath.join('.')}[${sourceIndex}].${derivation.sourceIdField}`, message: 'Runtime derivation source identity is missing' });
      continue;
    }
    setDerivedValue(targets[index], derivation.outputField, source[derivation.sourceIdField], path, issues);
  }
}

function applyIntervalReferences(root, derivation, issues) {
  const targets = readCollection(root, derivation.targetPath, derivation.targetPath.join('.'), issues);
  const events = readCollection(root, derivation.eventsPath, derivation.eventsPath.join('.'), issues);
  if (!targets || !events) return;
  const windows = [];
  let cursor = 0;
  for (const [index, target] of targets.entries()) {
    if (!isRecord(target)) {
      issues.push({ path: `${dataObjectPath(derivation.targetPath)}[${index}]`, message: 'Runtime interval target must be an object' });
      return;
    }
    const targetPath = `${dataObjectPath(derivation.targetPath)}[${index}]`;
    const duration = readNumber(target[derivation.durationField], `${targetPath}[${JSON.stringify(derivation.durationField)}]`, issues);
    if (duration === null) return;
    if (duration <= 0) {
      issues.push({ path: `${targetPath}[${JSON.stringify(derivation.durationField)}]`, message: 'Runtime interval duration must be positive' });
      return;
    }
    const end = cursor + duration;
    if (!Number.isFinite(end)) {
      issues.push({ path: targetPath, message: 'Runtime interval window is not finite' });
      return;
    }
    windows.push({ start: cursor, end });
    cursor = end;
  }
  const eventRows = [];
  const seenEventIds = new Set();
  for (const [index, event] of events.entries()) {
    const path = `${dataObjectPath(derivation.eventsPath)}[${index}]`;
    if (!isRecord(event) || typeof event[derivation.eventIdField] !== 'string') {
      issues.push({ path: `${path}[${JSON.stringify(derivation.eventIdField)}]`, message: 'Runtime interval event identity is missing' });
      return;
    }
    if (seenEventIds.has(event[derivation.eventIdField])) {
      issues.push({ path: `${path}[${JSON.stringify(derivation.eventIdField)}]`, message: 'Runtime interval event identity must be unique' });
      return;
    }
    seenEventIds.add(event[derivation.eventIdField]);
    const start = readNumber(event[derivation.startField], `${path}[${JSON.stringify(derivation.startField)}]`, issues);
    const end = readNumber(event[derivation.endField], `${path}[${JSON.stringify(derivation.endField)}]`, issues);
    if (start === null || end === null) return;
    if (end <= start) {
      issues.push({ path, message: 'Runtime interval event must have positive length' });
      return;
    }
    const matches = windows.map((window, windowIndex) => ({ window, windowIndex })).filter(({ window }) => (
      derivation.match === 'overlap'
        ? start < window.end && end > window.start
        : start >= window.start && end <= window.end
    ));
    if (derivation.match === 'containedByExactlyOne' && matches.length !== 1) {
      issues.push({ path, message: describeIntervalContainmentFailure({ start, end, windows }) });
      return;
    }
    eventRows.push({ id: event[derivation.eventIdField], matches });
  }
  for (const [targetIndex, target] of targets.entries()) {
    const ids = eventRows.filter(({ matches }) => matches.some(match => match.windowIndex === targetIndex)).map(({ id }) => id);
    setDerivedValue(target, derivation.outputField, ids, `${dataObjectPath(derivation.targetPath)}[${targetIndex}]`, issues);
  }
}

const INTERVAL_WINDOW_LIST_LIMIT = 16;
const formatSeconds = value => String(Number(value.toFixed(3)));

/**
 * 区间事件必须整体落在恰好一个窗口内。错误信息给出可行动的事实（事件区间、与之相交的窗口、
 * 全部窗口区间和修法），否则模型只能盲改并在同一个校验上反复失败（实测一次作者执行连续 3+ 轮
 * 重复同一条「必须被恰好一个目标窗口包含」，每轮重发 3~7 万 token 上下文）。
 */
export function describeIntervalContainmentFailure({ start, end, windows }) {
  const label = (window, index) => `#${index} [${formatSeconds(window.start)}, ${formatSeconds(window.end)}]`;
  const crossing = windows.map((window, index) => ({ window, index }))
    .filter(({ window }) => start < window.end && end > window.start);
  const all = windows.slice(0, INTERVAL_WINDOW_LIST_LIMIT).map(label).join('; ')
    + (windows.length > INTERVAL_WINDOW_LIST_LIMIT ? `; … (${windows.length} windows)` : '');
  const eventText = `[${formatSeconds(start)}, ${formatSeconds(end)}]`;
  const reason = crossing.length === 0
    ? `it lies outside every target window (total span [0, ${formatSeconds(windows.at(-1)?.end ?? 0)}])`
    : `it overlaps ${crossing.length} window${crossing.length === 1 ? '' : 's'} (${crossing.map(({ window, index }) => label(window, index)).join(', ')}) but is not fully inside exactly one`;
  return `Runtime interval event ${eventText} must be contained by exactly one target window: ${reason}. `
    + `Target windows: ${all}. Fix: move its start/end entirely inside one window, or split it at the window boundary into separate events (keep each event inside a single window).`;
}

function setPathValue(root, path, expected, issues) {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(current) || !hasOwn(current, segment)) {
      issues.push({ path: `$.${path.join('.')}`, message: 'Runtime derivation output path is missing' });
      return;
    }
    current = current[segment];
  }
  if (!isRecord(current)) {
    issues.push({ path: `$.${path.join('.')}`, message: 'Runtime derivation output parent must be an object' });
    return;
  }
  setDerivedValue(current, path.at(-1), expected, `$`, issues);
}

function setArrayPathValues(root, path, values, issues, origin = '') {
  const wildcardIndex = path.indexOf('*');
  const prefix = path.slice(0, wildcardIndex);
  const suffix = path.slice(wildcardIndex + 1);
  if (wildcardIndex < 0 || suffix.length === 0) {
    issues.push({ path: `$.${path.join('.')}`, message: 'Runtime derivation output path must contain an array wildcard and a field' });
    return;
  }
  let collection = root;
  for (const segment of prefix) {
    if (!isRecord(collection) || !hasOwn(collection, segment)) {
      issues.push({ path: `$.${prefix.join('.')}`, message: 'Runtime derivation output collection is missing' });
      return;
    }
    collection = collection[segment];
  }
  if (!Array.isArray(collection)) {
    issues.push({ path: `$.${prefix.join('.')}`, message: 'Runtime derivation output collection must be an array' });
    return;
  }
  if (collection.length !== values.length) {
    issues.push({ path: `$.${prefix.join('.')}`, message: `Runtime derivation output item count ${collection.length} does not match derived count ${values.length}; provide exactly ${values.length} item${values.length === 1 ? '' : 's'} in $.${prefix.join('.')}${origin ? ` (${origin})` : ''}` });
    return;
  }
  for (let index = 0; index < collection.length; index += 1) {
    let target = collection[index];
    for (const segment of suffix.slice(0, -1)) {
      if (!isRecord(target) || !hasOwn(target, segment)) {
        issues.push({ path: `$.${prefix.join('.')}[${index}].${suffix.join('.')}`, message: 'Runtime derivation output path is missing' });
        target = null;
        break;
      }
      target = target[segment];
    }
    if (target !== null) setDerivedValue(target, suffix.at(-1), values[index], `$.${prefix.join('.')}[${index}]`, issues);
  }
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

export function materializeRuntimeDerivations(value, derivations, issues) {
  for (const derivation of derivations) {
    if (derivation.op === 'sum') applySum(value, derivation, issues);
    else if (derivation.op === 'prefixSums') applyPrefixSums(value, derivation, issues);
    else if (derivation.op === 'indexReference') applyIndexReference(value, derivation, issues);
    else if (derivation.op === 'intervalReferences') applyIntervalReferences(value, derivation, issues);
  }
  return value;
}
