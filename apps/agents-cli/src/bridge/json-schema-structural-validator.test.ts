import assert from "node:assert/strict";
import test from "node:test";
import { chapterBeatPlanSchema } from "../../../../packages/schemas/video-authoring-stages/schema.mjs";

import {
  validateJsonSchemaStructure,
} from "./json-schema-structural-validator.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", const: "preflight_begin" },
    beatSheetHeader: {
      type: "object",
      additionalProperties: false,
      properties: {
        sourceCoveragePlan: {
          type: "object",
          additionalProperties: false,
          properties: {
            spans: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  clipIndex: { type: "integer", minimum: 0 },
                  sourceStartMarker: { type: "string", minLength: 1 },
                  sourceEndMarker: { type: "string", minLength: 1 },
                },
                required: ["clipIndex", "sourceStartMarker", "sourceEndMarker"],
              },
            },
          },
          required: ["spans"],
        },
      },
      required: ["sourceCoveragePlan"],
    },
  },
  required: ["mode", "beatSheetHeader"],
} satisfies Record<string, unknown>;

test("author submission rejects an out-of-range collection reference using the shared stage schema", () => {
  const value = { beats: [{}, {}], sourceCoveragePlan: { speechLedger: [{ clipIndex: 2 }] } };
  const issues = validateJsonSchemaStructure({ schema: chapterBeatPlanSchema, value });
  assert.ok(issues.some(issue => issue.keyword === 'x-indexReferences'
    && issue.path === '$.sourceCoveragePlan.speechLedger[0].clipIndex'));
  value.sourceCoveragePlan.speechLedger[0].clipIndex = 1;
  assert.ok(!validateJsonSchemaStructure({ schema: chapterBeatPlanSchema, value })
    .some(issue => issue.keyword === 'x-indexReferences'));
});

test("reports exact nested paths for missing and invented JSON fields", () => {
  const issues = validateJsonSchemaStructure({
    schema,
    value: {
      mode: "preflight_begin",
      beatSheetHeader: {
        sourceCoveragePlan: {
          spans: [{ clipIndex: 0, startAnchor: "原文开头", endAnchor: "原文结尾" }],
        },
      },
    },
  });

  assert.deepEqual(
    issues.map((issue) => [issue.path, issue.keyword]),
    [
      ["$.beatSheetHeader.sourceCoveragePlan.spans[0].sourceStartMarker", "required"],
      ["$.beatSheetHeader.sourceCoveragePlan.spans[0].sourceEndMarker", "required"],
      ["$.beatSheetHeader.sourceCoveragePlan.spans[0].startAnchor", "additionalProperties"],
      ["$.beatSheetHeader.sourceCoveragePlan.spans[0].endAnchor", "additionalProperties"],
    ],
  );
});

test("accepts a structurally valid exact operation payload", () => {
  const issues = validateJsonSchemaStructure({
    schema,
    value: {
      mode: "preflight_begin",
      beatSheetHeader: {
        sourceCoveragePlan: {
          spans: [{
            clipIndex: 0,
            sourceStartMarker: "原文开头",
            sourceEndMarker: "原文结尾",
          }],
        },
      },
    },
  });

  assert.deepEqual(issues, []);
});

test("oneOf diagnostics prefer the branch sharing the submitted structural keys", () => {
  const issues = validateJsonSchemaStructure({
    schema: {
      oneOf: [{
        type: "object",
        properties: {
          sourceCoveragePlan: {
            type: "object",
            properties: { endUnitIds: { type: "array" } },
            required: ["endUnitIds"],
            additionalProperties: false,
          },
        },
        required: ["sourceCoveragePlan"],
        additionalProperties: false,
      }, {
        type: "object",
        properties: {
          storyFactsContext: {
            type: "object",
            properties: {
              mode: { type: "string" },
              consumedFactIds: { type: "array" },
            },
            required: ["mode", "consumedFactIds"],
            additionalProperties: false,
          },
        },
        required: ["storyFactsContext"],
        additionalProperties: false,
      }],
    },
    value: { storyFactsContext: { consumedFactIds: [] } },
  });

  assert.ok(issues.some((issue) => issue.path === "$.storyFactsContext.mode"));
  assert.ok(!issues.some((issue) => issue.path === "$.sourceCoveragePlan"));
});

test('large enum repair diagnostics reference the frozen schema instead of replicating its inventory', () => {
  const inventory = Array.from({length:500},(_,index)=>`asset-${index}-${'x'.repeat(250)}`);
  const schema = {type:'object',properties:{objects:{type:'array',items:{type:'object',properties:{refs:{type:'array',items:{type:'string',enum:inventory}}}}}}};
  const value = {objects:Array.from({length:4},()=>({refs:['shortened-id']}))};
  const original=JSON.stringify(value);
  const issues = validateJsonSchemaStructure({schema,value});
  assert.equal(issues.length,4);
  assert.equal(issues[0]?.schemaPath,'$.properties.objects.items.properties.refs.items.enum');
  assert.match(issues[0]!.message,/500-value enum/);
  assert.match(issues[0]!.message,/shortened-id/);
  assert.ok(issues.map(issue=>issue.message).join(';').length<1600);
  assert.equal(JSON.stringify(value),original);
  assert.equal(validateJsonSchemaStructure({schema,value:{objects:[{refs:[inventory[499]]}]}}).length,0);
});

test('small enum errors retain every allowed value and the observed invalid value', () => {
  const issues=validateJsonSchemaStructure({schema:{type:'string',enum:['identity','environment']},value:'scene'});
  assert.match(issues[0]!.message,/"identity", "environment"; received "scene"/);
});

test('contains validates registered array membership with explicit cardinality', () => {
  const schema = { type: 'array', contains: { type: 'object', properties: { objectId: { enum: ['scene-1'] } }, required: ['objectId'] } };
  assert.equal(validateJsonSchemaStructure({ schema, value: [{ objectId: 'hero' }] }).length, 1);
  assert.deepEqual(validateJsonSchemaStructure({ schema, value: [{ objectId: 'hero' }, { objectId: 'scene-1' }] }), []);
  assert.deepEqual(validateJsonSchemaStructure({ schema: { ...schema, minContains: 0 }, value: [] }), []);
  assert.equal(validateJsonSchemaStructure({ schema: { ...schema, maxContains: 1 }, value: [{ objectId: 'scene-1' }, { objectId: 'scene-1' }] }).length, 1);
});

test('shared field relations apply inside array object schemas', () => {
 const schema={type:'array',items:{type:'object','x-fieldRelations':[{left:'end',operator:'gt',right:'start'}]}};
 assert.equal(validateJsonSchemaStructure({schema,value:[{start:2,end:2}]}).length,1);
 assert.deepEqual(validateJsonSchemaStructure({schema,value:[{start:2,end:3}]}),[]);
});
