export const SOURCE_PARTITION_KEYWORD = 'x-sourcePartition';
export const SOURCE_ALLOCATION_KEYWORD = 'x-sourceAllocation';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const textSchema = () => ({ type: 'string', minLength: 1 });
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const deliveries = ['on_screen', 'off_screen', 'voice_over'];
const expressions = ['spoken', 'thought', 'written', 'narration'];
const canonicalUnitCommon = { unitId: textSchema(), sourceLineId: textSchema(), text: textSchema() };
const canonicalUnitSchema = properties => ({
  ...objectSchema(properties),
  properties: { ...properties, attributionEvidence: { type: 'string' } },
});
const authoredUnitCommon = {
  sourceLineId: textSchema(),
  startOffset: { type: 'integer', minimum: 0 },
  endOffset: { type: 'integer', minimum: 1 },
};
export const sourceUnitLedgerSchema = objectSchema({
  sourceId: textSchema(), sourceFingerprint: textSchema(),
  units: { type: 'array', minItems: 1, items: { anyOf: [
    canonicalUnitSchema({ ...canonicalUnitCommon, expression: { type: 'string', enum: ['spoken', 'thought'] },
      speakerName: textSchema(), delivery: { type: 'string', enum: deliveries } }),
    canonicalUnitSchema({ ...canonicalUnitCommon, expression: { type: 'string', enum: ['written', 'narration'] },
      speakerName: { type: ['string', 'null'], minLength: 1 }, delivery: { type: 'null' } }),
  ] } },
});
/** Compact Agent submission; the runtime materializes canonical unit text from frozen source lines. */
export const authoredSourceUnitLedgerSchema = objectSchema({
  sourceId: textSchema(), sourceFingerprint: textSchema(),
  units: { type: 'array', minItems: 1, items: { anyOf: [
    objectSchema({ ...authoredUnitCommon, expression: { type: 'string', enum: ['spoken', 'thought'] },
      speakerName: textSchema(), delivery: { type: 'string', enum: deliveries } }),
    objectSchema({ ...authoredUnitCommon, expression: { type: 'string', enum: ['written', 'narration'] },
      speakerName: { type: ['string', 'null'], minLength: 1 }, delivery: { type: 'null' } }),
  ] } },
});

/** Layout-only segmentation. No quotation, speaker or meaning inference. */
export function buildSourceLines(text) {
  if (typeof text !== 'string') throw new TypeError('Source text must be a string');
  return text.split(/\r\n|\r|\n/u).flatMap((line, index) => {
    const trimmed = line.trim();
    return trimmed ? [{ lineId: `source-line-${index + 1}`, text: trimmed }] : [];
  });
}

function extraFields(value, allowed, path, issues) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    issues.push({ path: `${path}[${JSON.stringify(key)}]`, message: 'Unexpected field' });
  }
}
function ledgerShape(value, path) {
  const issues = [];
  if (!record(value)) return [{ path, message: 'Source unit ledger must be an object' }];
  extraFields(value, ['sourceId', 'sourceFingerprint', 'units'], path, issues);
  for (const key of ['sourceId', 'sourceFingerprint']) if (!nonempty(value[key])) issues.push({ path: `${path}.${key}`, message: `${key} must be a non-empty string` });
  if (!Array.isArray(value.units) || value.units.length === 0) return [...issues, { path: `${path}.units`, message: 'units must be a non-empty array' }];
  const seen = new Set();
  for (const [index, unit] of value.units.entries()) {
    const at = `${path}.units[${index}]`;
    if (!record(unit)) { issues.push({ path: at, message: 'Source unit must be an object' }); continue; }
    extraFields(unit, ['unitId', 'sourceLineId', 'text', 'attributionEvidence', 'expression', 'speakerName', 'delivery'], at, issues);
    if (unit.attributionEvidence !== undefined && typeof unit.attributionEvidence !== 'string') {
      issues.push({ path: `${at}.attributionEvidence`, message: 'attributionEvidence must be a string' });
    }
    for (const key of ['unitId', 'sourceLineId', 'text']) if (!nonempty(unit[key])) issues.push({ path: `${at}.${key}`, message: `${key} must be a non-empty string` });
    if (nonempty(unit.unitId)) {
      if (seen.has(unit.unitId)) issues.push({ path: `${at}.unitId`, message: `Duplicate unitId ${JSON.stringify(unit.unitId)}` });
      seen.add(unit.unitId);
    }
    if (!expressions.includes(unit.expression)) issues.push({ path: `${at}.expression`, message: 'expression must be spoken, thought, written or narration' });
    if (unit.expression === 'spoken' || unit.expression === 'thought') {
      if (!nonempty(unit.speakerName)) issues.push({ path: `${at}.speakerName`, message: 'Vocal units require a non-empty speakerName' });
      if (!deliveries.includes(unit.delivery)) issues.push({ path: `${at}.delivery`, message: 'Vocal units require on_screen, off_screen or voice_over delivery' });
    } else if (unit.expression === 'written' || unit.expression === 'narration') {
      if (unit.speakerName !== null && !nonempty(unit.speakerName)) issues.push({ path: `${at}.speakerName`, message: 'speakerName must be null or a non-empty string' });
      if (unit.delivery !== null) issues.push({ path: `${at}.delivery`, message: 'Written and narration units require null delivery' });
    }
  }
  return issues;
}

function inspectFacts(facts) {
  if (!record(facts) || !nonempty(facts.sourceId) || !nonempty(facts.sourceFingerprint)
    || !Array.isArray(facts.lines) || facts.lines.length === 0) return [{ path: '$facts', message: 'Frozen source facts require sourceId, sourceFingerprint and non-empty lines' }];
  const issues = [], seen = new Set();
  for (const [index, line] of facts.lines.entries()) {
    if (!record(line) || !nonempty(line.lineId) || !nonempty(line.text)) { issues.push({ path: `$facts.lines[${index}]`, message: 'Frozen source line requires non-empty lineId and text' }); continue; }
    if (seen.has(line.lineId)) issues.push({ path: `$facts.lines[${index}].lineId`, message: 'Frozen source line IDs must be unique' });
    seen.add(line.lineId);
  }
  return issues;
}

function splitsSurrogate(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const previous = text.charCodeAt(offset - 1), next = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function sourcePartitionFacts(facts) {
  return {
    sourceId: facts.sourceId,
    sourceFingerprint: facts.sourceFingerprint,
    lines: facts.lines.map(line => ({
      lineId: line.lineId,
      length: line.text.length,
      surrogateBoundaries: Array.from({ length: Math.max(0, line.text.length - 1) }, (_, index) => index + 1)
        .filter(offset => splitsSurrogate(line.text, offset)),
    })),
  };
}

function inspectPartitionFacts(facts) {
  if (!record(facts) || !nonempty(facts.sourceId) || !nonempty(facts.sourceFingerprint)
    || !Array.isArray(facts.lines) || facts.lines.length === 0) {
    return [{ path: '$facts', message: 'Frozen source partition requires sourceId, sourceFingerprint and non-empty lines' }];
  }
  const issues = [];
  const seen = new Set();
  for (const [index, line] of facts.lines.entries()) {
    const at = `$facts.lines[${index}]`;
    if (!record(line) || !nonempty(line.lineId) || !Number.isSafeInteger(line.length) || line.length < 1) {
      issues.push({ path: at, message: 'Frozen source partition line requires lineId and positive UTF-16 length' });
      continue;
    }
    if (seen.has(line.lineId)) issues.push({ path: `${at}.lineId`, message: 'Frozen source line IDs must be unique' });
    seen.add(line.lineId);
    if (line.surrogateBoundaries !== undefined && (!Array.isArray(line.surrogateBoundaries)
      || !line.surrogateBoundaries.every(offset => Number.isSafeInteger(offset) && offset > 0 && offset < line.length))) {
      issues.push({ path: `${at}.surrogateBoundaries`, message: 'UTF-16 surrogate boundaries must be offsets within the frozen line' });
    }
  }
  return issues;
}

/** Validate only structural source coverage and the author's typed semantics. */
export function inspectAuthoredSourceUnitPartition(value, facts) {
  const issues = [...inspectPartitionFacts(facts)];
  if (!record(value)) return [...issues, { path: '$', message: 'Authored source partition must be an object' }];
  extraFields(value, ['sourceId', 'sourceFingerprint', 'units'], '$', issues);
  for (const key of ['sourceId', 'sourceFingerprint']) {
    if (!nonempty(value[key])) issues.push({ path: `$.${key}`, message: `${key} must be a non-empty string` });
    else if (nonempty(facts?.[key]) && value[key] !== facts[key]) issues.push({ path: `$.${key}`, message: `${key} must equal the frozen source value ${JSON.stringify(facts[key])}` });
  }
  if (!Array.isArray(value.units) || value.units.length === 0) {
    return [...issues, { path: '$.units', message: 'units must be a non-empty array' }];
  }
  const lines = Array.isArray(facts?.lines) ? facts.lines : [];
  const lineIndexes = new Map(lines.map((line, index) => [line.lineId, index]));
  const partitions = lines.map(() => []);
  const allowedUnitFields = ['sourceLineId', 'startOffset', 'endOffset', 'expression', 'speakerName', 'delivery'];
  let previousLineIndex = -1;
  value.units.forEach((unit, index) => {
    const at = `$.units[${index}]`;
    if (!record(unit)) { issues.push({ path: at, message: 'Source partition unit must be an object' }); return; }
    extraFields(unit, allowedUnitFields, at, issues);
    if (!nonempty(unit.sourceLineId)) issues.push({ path: `${at}.sourceLineId`, message: 'sourceLineId must be a non-empty string' });
    const lineIndex = lineIndexes.get(unit.sourceLineId);
    if (lineIndex === undefined) issues.push({ path: `${at}.sourceLineId`, message: `Unknown frozen sourceLineId ${JSON.stringify(unit.sourceLineId)}` });
    else {
      if (lineIndex < previousLineIndex) issues.push({ path: `${at}.sourceLineId`, message: 'Source units must follow frozen line order without returning to an earlier line' });
      previousLineIndex = lineIndex;
      partitions[lineIndex]?.push({ unit, index });
    }
    if (!Number.isSafeInteger(unit.startOffset) || unit.startOffset < 0) issues.push({ path: `${at}.startOffset`, message: 'startOffset must be a non-negative UTF-16 integer' });
    if (!Number.isSafeInteger(unit.endOffset) || unit.endOffset < 1) issues.push({ path: `${at}.endOffset`, message: 'endOffset must be a positive UTF-16 integer' });
    if (!expressions.includes(unit.expression)) issues.push({ path: `${at}.expression`, message: 'expression must be spoken, thought, written or narration' });
    if (unit.expression === 'spoken' || unit.expression === 'thought') {
      if (!nonempty(unit.speakerName)) issues.push({ path: `${at}.speakerName`, message: 'Vocal units require a non-empty speakerName' });
      if (!deliveries.includes(unit.delivery)) issues.push({ path: `${at}.delivery`, message: 'Vocal units require on_screen, off_screen or voice_over delivery' });
    } else if (unit.expression === 'written' || unit.expression === 'narration') {
      if (unit.speakerName !== null && !nonempty(unit.speakerName)) issues.push({ path: `${at}.speakerName`, message: 'speakerName must be null or a non-empty string' });
      if (unit.delivery !== null) issues.push({ path: `${at}.delivery`, message: 'Written and narration units require null delivery' });
    }
  });

  lines.forEach((line, lineIndex) => {
    const units = partitions[lineIndex] ?? [];
    if (units.length === 0) {
      issues.push({ path: '$.units', message: `Missing source line ${JSON.stringify(line.lineId)}; every frozen line requires a partition` });
      return;
    }
    let cursor = 0;
    const surrogateBoundaries = new Set(Array.isArray(line.surrogateBoundaries) ? line.surrogateBoundaries : []);
    for (const { unit, index } of units) {
      const at = `$.units[${index}]`;
      if (!Number.isSafeInteger(unit.startOffset) || !Number.isSafeInteger(unit.endOffset)) continue;
      if (unit.startOffset !== cursor) issues.push({ path: `${at}.startOffset`, message: `Source units must partition ${JSON.stringify(line.lineId)} continuously from UTF-16 offset ${cursor}` });
      if (unit.startOffset < 0 || unit.endOffset <= unit.startOffset || unit.endOffset > line.length) {
        issues.push({ path: `${at}.endOffset`, message: `Source unit range must be within [0,${line.length}] and have positive length` });
        continue;
      }
      if (surrogateBoundaries.has(unit.startOffset) || surrogateBoundaries.has(unit.endOffset)) {
        issues.push({ path: at, message: 'Source unit offsets must not split a UTF-16 surrogate pair' });
      }
      cursor = unit.endOffset;
    }
    if (cursor !== line.length) issues.push({ path: '$.units', message: `Source units must cover all ${line.length} UTF-16 code units of ${JSON.stringify(line.lineId)}; coverage ends at ${cursor}` });
  });
  return issues;
}

export function inspectSourceUnitLedger(value, facts) {
  const issues = [...inspectFacts(facts), ...ledgerShape(value, '$')];
  if (issues.length) return issues;
  for (const key of ['sourceId', 'sourceFingerprint']) if (value[key] !== facts[key]) issues.push({ path: `$.${key}`, message: `${key} must equal the frozen source value ${JSON.stringify(facts[key])}` });
  const lineOrder = new Map(facts.lines.map((line, index) => [line.lineId, index]));
  let previousIndex = -1;
  value.units.forEach((unit, index) => {
    const sourceIndex = lineOrder.get(unit.sourceLineId);
    if (sourceIndex === undefined) { issues.push({ path: `$.units[${index}].sourceLineId`, message: `Unknown frozen sourceLineId ${JSON.stringify(unit.sourceLineId)}` }); return; }
    if (sourceIndex < previousIndex) issues.push({ path: `$.units[${index}].sourceLineId`, message: 'Source units must follow frozen line order without returning to an earlier line' });
    previousIndex = sourceIndex;
  });
  for (const line of facts.lines) {
    const units = value.units.filter(unit => unit.sourceLineId === line.lineId);
    if (units.length === 0) issues.push({ path: '$.units', message: `Missing source line ${JSON.stringify(line.lineId)}` });
    else if (units.map(unit => unit.text).join('') !== line.text) issues.push({ path: '$.units', message: `Canonical source units must equal the frozen text of ${JSON.stringify(line.lineId)}` });
  }
  return issues;
}

/** Convert compact authored ranges into the existing canonical, text-bearing ledger. */
export function reconstructSourceUnitLedger(value, facts) {
  const factIssues = inspectFacts(facts);
  if (factIssues.length) throw new SourceUnitReferenceError(factIssues);
  const issues = inspectAuthoredSourceUnitPartition(value, sourcePartitionFacts(facts));
  if (issues.length) throw new SourceUnitReferenceError(issues);
  const sourceLines = new Map(facts.lines.map(line => [line.lineId, line.text]));
  const units = value.units.map(unit => ({
    unitId: `source-unit:${encodeURIComponent(unit.sourceLineId)}:${unit.startOffset}:${unit.endOffset}`,
    sourceLineId: unit.sourceLineId,
    text: sourceLines.get(unit.sourceLineId).slice(unit.startOffset, unit.endOffset),
    expression: unit.expression,
    speakerName: unit.speakerName,
    delivery: unit.delivery,
  }));
  return { sourceId: value.sourceId, sourceFingerprint: value.sourceFingerprint, units };
}

export function bindSourceUnitLedgerSchema(facts) {
  const issues = inspectFacts(facts);
  if (issues.length) throw new SourceUnitReferenceError(issues);
  const schema = structuredClone(authoredSourceUnitLedgerSchema);
  const lineIds = facts.lines.map(line => line.lineId);
  for (const branch of schema.properties.units.items.anyOf) {
    branch.properties.sourceLineId.enum = lineIds;
  }
  return { ...schema, [SOURCE_PARTITION_KEYWORD]: sourcePartitionFacts(facts) };
}

export class SourceUnitReferenceError extends Error {
  constructor(issues) {
    super(issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'SourceUnitReferenceError';
    this.issues = issues;
  }
}

/** Project all dialogue from its unique source owner. Offsets are UTF-16 code units.
 *
 * The authoring contract emits `{ unitId, endOffset? }`: `startOffset` is pure
 * cursor state (the previous reference's end) and is derived here, never typed
 * by the model. An explicitly supplied `startOffset` stays accepted only as a
 * consistency check for artifacts frozen before the derivation (it must equal
 * the cursor), so already-persisted executions keep projecting identically.
 * `endOffset` remains an authored fact only where a unit splits across beats;
 * omitted means the remainder of the unit.
 */
export function projectSourceUnitReferences(ledger, beats) {
  const issues = ledgerShape(ledger, '$ledger');
  if (!Array.isArray(beats) || beats.length === 0) issues.push({ path: '$.beats', message: 'beats must be a non-empty array' });
  if (issues.length) throw new SourceUnitReferenceError(issues);
  const units = new Map(ledger.units.map(unit => [unit.unitId, unit]));
  let expectedUnitIndex = 0, expectedOffset = 0;
  const speechLedger = [];
  const projected = beats.map((beat, clipIndex) => {
    const at = `$.beats[${clipIndex}]`;
    if (!record(beat) || !Array.isArray(beat.sourceUnitRefs)) { issues.push({ path: `${at}.sourceUnitRefs`, message: 'Each beat requires a sourceUnitRefs array' }); return beat; }
    if (Object.hasOwn(beat, 'dialogueScript')) issues.push({ path: `${at}.dialogueScript`, message: 'Authored dialogueScript is not allowed; dialogue must be projected exclusively from sourceUnitRefs' });
    const dialogueScript = [];
    const sourceUnitRefs = [];
    let beatFailed = false;
    beat.sourceUnitRefs.forEach((ref, index) => {
      const refPath = `${at}.sourceUnitRefs[${index}]`;
      if (!record(ref)) { issues.push({ path: refPath, message: 'Source unit reference must be an object' }); beatFailed = true; return; }
      extraFields(ref, ['unitId', 'startOffset', 'endOffset'], refPath, issues);
      const unit = units.get(ref.unitId);
      if (!unit) { issues.push({ path: `${refPath}.unitId`, message: `Unknown source unit ${JSON.stringify(ref.unitId)}` }); beatFailed = true; return; }
      const expectedUnit = ledger.units[expectedUnitIndex];
      if (unit.unitId !== expectedUnit?.unitId) {
        issues.push({ path: refPath, message: expectedUnit
          ? `Expected the next continuous range of unit ${JSON.stringify(expectedUnit.unitId)} starting at ${expectedOffset}; references must cover every unit once in source order`
          : 'All source units are already fully allocated; duplicate references are not allowed' });
        beatFailed = true; return;
      }
      if (ref.startOffset !== undefined && ref.startOffset !== expectedOffset) {
        issues.push({ path: `${refPath}.startOffset`, message: `startOffset must equal the derived cursor ${expectedOffset}; the host projects it from reference order` });
        beatFailed = true; return;
      }
      const startOffset = expectedOffset;
      const endOffset = ref.endOffset === undefined ? unit.text.length : ref.endOffset;
      if (!Number.isSafeInteger(endOffset) || endOffset <= startOffset || endOffset > unit.text.length) {
        issues.push({ path: `${refPath}.endOffset`, message: `endOffset must define a positive UTF-16 range within (startOffset,${unit.text.length}]` });
        beatFailed = true; return;
      }
      if (splitsSurrogate(unit.text, startOffset) || splitsSurrogate(unit.text, endOffset)) {
        issues.push({ path: refPath, message: 'Reference offsets must not split a UTF-16 surrogate pair' });
        beatFailed = true; return;
      }
      sourceUnitRefs.push({ unitId: unit.unitId, startOffset, endOffset });
      expectedOffset = endOffset;
      if (expectedOffset === unit.text.length) { expectedUnitIndex += 1; expectedOffset = 0; }
      if (unit.expression === 'spoken' || unit.expression === 'thought') {
        const line = { lineId: `source-unit:${encodeURIComponent(unit.unitId)}:${startOffset}:${endOffset}`,
          speakerName: unit.speakerName, text: unit.text.slice(startOffset, endOffset), delivery: unit.delivery };
        dialogueScript.push(line);
        speechLedger.push({ ...line, clipIndex });
      }
    });
    if (beatFailed) return beat;
    return { ...beat, sourceUnitRefs, dialogueScript };
  });
  if (expectedUnitIndex < ledger.units.length) issues.push({ path: '$.beats', message: `Source allocation is incomplete at unit ${JSON.stringify(ledger.units[expectedUnitIndex].unitId)} offset ${expectedOffset}; all units, including written and narration, require complete coverage` });
  if (issues.length) throw new SourceUnitReferenceError(issues);
  return { beats: projected, speechLedger };
}

/** Generic schema annotations; the validator decides how to return these structural issues. */
export function inspectSourceRelations(schema, value, path = '$') {
  if (!record(schema)) return [];
  const issues = [];
  const prefix = issuePath => issuePath.startsWith('$.') ? path + issuePath.slice(1) : issuePath === '$' ? path : issuePath;
  if (Object.hasOwn(schema, SOURCE_PARTITION_KEYWORD)) {
    issues.push(...inspectAuthoredSourceUnitPartition(value, schema[SOURCE_PARTITION_KEYWORD]).map(issue => ({ ...issue, path: prefix(issue.path), keyword: SOURCE_PARTITION_KEYWORD })));
  }
  if (Object.hasOwn(schema, SOURCE_ALLOCATION_KEYWORD)) {
    const allocation = schema[SOURCE_ALLOCATION_KEYWORD];
    if (record(allocation) && record(allocation.ledger)) {
      for (const key of ['sourceId', 'sourceFingerprint']) {
        if (nonempty(allocation.ledger[key]) && (!record(value) || value[key] !== allocation.ledger[key])) {
          issues.push({ path: `${path}.${key}`, keyword: SOURCE_ALLOCATION_KEYWORD,
            message: `${key} must equal the frozen source ledger value ${JSON.stringify(allocation.ledger[key])}` });
        }
      }
    }
    try {
      projectSourceUnitReferences(record(allocation) ? allocation.ledger : undefined, record(value) ? value.beats : undefined);
    } catch (error) {
      if (!(error instanceof SourceUnitReferenceError)) throw error;
      issues.push(...error.issues.map(issue => ({ ...issue, path: prefix(issue.path), keyword: SOURCE_ALLOCATION_KEYWORD })));
    }
  }
  return issues;
}
