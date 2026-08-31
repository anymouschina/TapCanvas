/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCurl,
  buildFullDocumentation,
  normalizeOpenApiDocument,
  normalizePricingPayload,
  resolveDefaultEndpointType,
  resolveCnyPriceDisplay,
} from './apiDocs.js';

const payload = {
  success: true,
  data: [
    {
      model_name: 'video-model',
      model_kind: 'video',
      quota_type: 1,
      model_price: 1,
      model_ratio: 0,
      supported_endpoint_types: ['openai-video'],
      param_pricing: {
        billing_mode: 'fixed_by_video_spec',
        results: [
          {
            spec_key: 'video:720p:5s',
            resolution: '720p',
            duration_seconds: 5,
            price_cny: 8.55,
            price_display_cny: '¥8.550000',
          },
        ],
      },
    },
    {
      model_name: 'image-model',
      model_kind: 'image',
      quota_type: 1,
      model_price: 0.4,
      model_ratio: 0,
      supported_endpoint_types: ['openai', 'image-generation'],
      param_pricing: {
        billing_mode: 'fixed_by_image_spec',
        results: [
          {
            spec_key: 'image:2k:high',
            resolution: '2k',
            duration_seconds: 0,
            price_cny: 4.6,
            price_display_cny: '¥4.600000',
          },
        ],
      },
    },
  ],
  supported_endpoint: {
    'openai-video': { path: '/v1/videos', method: 'POST' },
    'image-generation': { path: '/v1/images/generations', method: 'POST' },
    openai: { path: '/v1/chat/completions', method: 'POST' },
  },
};

const openApiDocument = {
  info: { title: 'AI模型接口', version: '1.1.0' },
  paths: { '/v1/models': { get: {} }, '/v1/videos': { post: {} } },
};

test('normalizes dynamic models and selects the endpoint from exact model kind', () => {
  const catalog = normalizePricingPayload(payload);
  const imageModel = catalog.models.find(
    (model) => model.modelName === 'image-model',
  );

  assert.equal(catalog.models.length, 2);
  assert.equal(resolveDefaultEndpointType(imageModel), 'image-generation');
  assert.equal(imageModel.specs[0].specKey, 'image:2k:high');
});

test('builds video curl with the selected duration and resolution', () => {
  const catalog = normalizePricingPayload(payload);
  const model = catalog.models.find(
    (candidate) => candidate.modelName === 'video-model',
  );
  const curl = buildCurl({
    baseUrl: 'https://api.example.com/',
    model,
    endpointType: 'openai-video',
    endpoint: catalog.endpoints['openai-video'],
    spec: model.specs[0],
  });

  assert.match(curl, /https:\/\/api\.example\.com\/v1\/videos/);
  assert.match(curl, /"resolution": "720p"/);
  assert.match(curl, /"duration": 5/);
});

test('builds image curl with quality from the public structured spec key', () => {
  const catalog = normalizePricingPayload(payload);
  const model = catalog.models.find(
    (candidate) => candidate.modelName === 'image-model',
  );
  const curl = buildCurl({
    baseUrl: 'https://api.example.com',
    model,
    endpointType: 'image-generation',
    endpoint: catalog.endpoints['image-generation'],
    spec: model.specs[0],
  });

  assert.match(curl, /"resolution": "2k"/);
  assert.match(curl, /"quality": "high"/);
});

test('does not guess an endpoint when kind is missing and choices are ambiguous', () => {
  const model = {
    modelKind: '',
    endpointTypes: ['openai', 'image-generation'],
  };
  assert.equal(resolveDefaultEndpointType(model), '');
});

test('shows the exact CNY consumption for the selected specification', () => {
  const catalog = normalizePricingPayload(payload);
  const model = catalog.models.find(
    (candidate) => candidate.modelName === 'video-model',
  );
  const price = resolveCnyPriceDisplay(model, model.specs[0]);

  assert.deepEqual(price, {
    label: '当前规格预计消耗',
    amount: '¥8.550000',
    detail: 'video:720p:5s · 单次成功请求',
    fixed: true,
  });
});

test('does not invent a fixed CNY amount for token-billed models', () => {
  const price = resolveCnyPriceDisplay(
    { quotaType: 0, modelPrice: 0, modelRatio: 0.14 },
    null,
  );

  assert.equal(price.amount, '按实际 Token 用量计费');
  assert.equal(price.fixed, false);
});

test('copies a complete AI-readable document from live catalog facts', () => {
  const catalog = normalizePricingPayload(payload);
  const openApi = normalizeOpenApiDocument(openApiDocument);
  const document = buildFullDocumentation({
    catalog,
    openApi,
    baseUrl: 'https://api.example.com',
  });

  assert.match(document, /# AI模型接口/);
  assert.match(document, /image:2k:high/);
  assert.match(document, /video:720p:5s/);
  assert.match(document, /curl --request POST/);
  assert.match(document, /## OpenAPI 完整定义/);
  assert.match(document, /"\/v1\/models"/);
});

test('rejects malformed pricing data instead of showing defaults', () => {
  assert.throws(
    () =>
      normalizePricingPayload({
        success: true,
        data: [],
        supported_endpoint: [],
      }),
    /端点数据格式无效/,
  );
});

test('rejects an endpoint entry with an empty path', () => {
  assert.throws(
    () =>
      normalizePricingPayload({
        ...payload,
        supported_endpoint: {
          ...payload.supported_endpoint,
          'openai-video': { path: '', method: 'POST' },
        },
      }),
    /openai-video\.path 缺失或格式无效/,
  );
});
