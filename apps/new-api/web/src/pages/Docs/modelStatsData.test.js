import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildModelChartRows,
  filterModelChartPayloadByCategory,
  normalizePublicModelCatalogPayload,
  normalizePublicModelChartPayload,
  summarizeModelChartRows,
} from './modelStatsData.js';

const catalog = {
  models: [
    { modelName: 'chat-model', modelKind: 'chat' },
    { modelName: 'image-model', modelKind: 'image' },
    { modelName: 'unused-model', modelKind: 'video' },
  ],
};

const payload = {
  success: true,
  data: {
    generated_at: 1_700_000_000,
    window_hours: 24,
    models: [
      {
        model_name: 'chat-model',
        model_kind: 'chat',
        call_count: 8,
        success_count: 7,
        success_rate: 0.875,
        specs: [
          {
            spec_key: '__standard__',
            spec_label: '标准调用',
            call_count: 8,
            success_count: 7,
            success_rate: 0.875,
          },
        ],
      },
      {
        model_name: 'image-model',
        model_kind: 'image',
        call_count: 4,
        success_count: 4,
        success_rate: 1,
        specs: [
          {
            spec_key: 'image:2k:high',
            spec_label: '2K · high',
            call_count: 4,
            success_count: 4,
            success_rate: 1,
          },
        ],
      },
    ],
  },
};

test('merges the complete runtime aggregate with every current catalog model', () => {
  const normalized = normalizePublicModelChartPayload(payload, catalog);

  assert.equal(normalized.models.length, 3);
  assert.deepEqual(
    normalized.models.find((model) => model.modelName === 'unused-model'),
    {
      modelName: 'unused-model',
      modelKind: 'video',
      callCount: 0,
      successCount: 0,
      successRate: 0,
      specs: [],
    },
  );
});

test('sorts call volume descending and filters by observed specification', () => {
  const normalized = normalizePublicModelChartPayload(payload, catalog);
  const rows = buildModelChartRows(normalized.models, 'calls', 'image:2k:high');

  assert.equal(rows[0].modelName, 'image-model');
  assert.equal(rows[0].callCount, 4);
  assert.equal(rows[0].barPercentage, 100);
  assert.equal(rows[1].callCount, 0);
});

test('sorts success rate with sampled models before zero-sample models', () => {
  const normalized = normalizePublicModelChartPayload(payload, catalog);
  const rows = buildModelChartRows(normalized.models, 'success', 'all');

  assert.deepEqual(
    rows.map((row) => row.modelName),
    ['image-model', 'chat-model', 'unused-model'],
  );
  assert.equal(rows[0].barPercentage, 100);
});

test('uses weighted successes for the chart summary', () => {
  const normalized = normalizePublicModelChartPayload(payload, catalog);
  const rows = buildModelChartRows(normalized.models, 'calls', 'all');

  assert.deepEqual(summarizeModelChartRows(rows), {
    callCount: 12,
    successRate: 11 / 12,
  });
});

test('normalizes the public pricing catalog without duplicating aliases', () => {
  const normalized = normalizePublicModelCatalogPayload({
    success: true,
    data: [
      { model_name: 'chat-model', model_kind: 'chat' },
      { model_name: 'chat-model', model_kind: 'chat' },
      { model_name: 'image-model', model_kind: 'image' },
    ],
  });

  assert.deepEqual(normalized, {
    models: [
      { modelName: 'chat-model', modelKind: 'chat' },
      { modelName: 'image-model', modelKind: 'image' },
    ],
  });
});

test('filters models and available specifications by homepage category', () => {
  const normalized = normalizePublicModelChartPayload(payload, catalog);
  const imagePayload = filterModelChartPayloadByCategory(normalized, 'image');

  assert.deepEqual(
    imagePayload.models.map((model) => model.modelName),
    ['image-model'],
  );
  assert.deepEqual(imagePayload.specOptions, [
    { specKey: 'image:2k:high', specLabel: '2K · high' },
  ]);
});

test('rejects malformed success rates instead of hiding data errors', () => {
  const malformed = structuredClone(payload);
  malformed.data.models[0].success_rate = 101;

  assert.throws(
    () => normalizePublicModelChartPayload(malformed, catalog),
    /0 到 1 之间/,
  );
});
