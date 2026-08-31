/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

const ENDPOINT_LABELS = Object.freeze({
  openai: 'Chat Completions',
  'openai-response': 'Responses',
  'openai-response-compact': 'Responses Compact',
  anthropic: 'Anthropic Messages',
  gemini: 'Gemini Generate Content',
  'jina-rerank': 'Rerank',
  'image-generation': 'Image Generations',
  embeddings: 'Embeddings',
  'openai-video': 'Video Generations',
  'audio-speech': 'Audio Speech',
});

const PREFERRED_ENDPOINTS_BY_KIND = Object.freeze({
  audio: ['audio-speech'],
  chat: ['openai-response', 'openai'],
  image: ['image-generation'],
  text: ['openai-response', 'openai'],
  video: ['openai-video'],
});

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 缺失或格式无效`);
  }
  return value.trim();
};

const optionalNumber = (value, field) => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} 必须是有限数字`);
  }
  return value;
};

const normalizeSpec = (spec, modelName, index) => {
  if (!isObject(spec)) {
    throw new Error(`${modelName} 的第 ${index + 1} 个规格格式无效`);
  }
  return {
    specKey: requireString(spec.spec_key, `${modelName}.spec_key`),
    resolution:
      typeof spec.resolution === 'string' ? spec.resolution.trim() : '',
    durationSeconds: optionalNumber(
      spec.duration_seconds,
      `${modelName}.duration_seconds`,
    ),
    priceCny: optionalNumber(spec.price_cny, `${modelName}.price_cny`),
    priceDisplayCny:
      typeof spec.price_display_cny === 'string'
        ? spec.price_display_cny.trim()
        : '',
  };
};

const normalizeModel = (entry, index) => {
  if (!isObject(entry)) {
    throw new Error(`第 ${index + 1} 个模型格式无效`);
  }
  const modelName = requireString(
    entry.model_name,
    `data[${index}].model_name`,
  );
  if (!Array.isArray(entry.supported_endpoint_types)) {
    throw new Error(`${modelName}.supported_endpoint_types 格式无效`);
  }
  const endpointTypes = entry.supported_endpoint_types.map((value) =>
    requireString(value, `${modelName}.supported_endpoint_types`),
  );
  const results = entry.param_pricing?.results;
  if (results !== undefined && !Array.isArray(results)) {
    throw new Error(`${modelName}.param_pricing.results 格式无效`);
  }
  return {
    modelName,
    modelKind:
      typeof entry.model_kind === 'string'
        ? entry.model_kind.trim().toLowerCase()
        : '',
    description:
      typeof entry.description === 'string' ? entry.description.trim() : '',
    endpointTypes,
    quotaType: optionalNumber(entry.quota_type, `${modelName}.quota_type`),
    modelPrice: optionalNumber(entry.model_price, `${modelName}.model_price`),
    modelRatio: optionalNumber(entry.model_ratio, `${modelName}.model_ratio`),
    pricingMode:
      typeof entry.param_pricing?.billing_mode === 'string'
        ? entry.param_pricing.billing_mode.trim()
        : '',
    specs: (results || []).map((spec, specIndex) =>
      normalizeSpec(spec, modelName, specIndex),
    ),
  };
};

export const normalizePricingPayload = (payload) => {
  if (!isObject(payload) || payload.success !== true) {
    throw new Error('模型与规格接口返回失败');
  }
  if (!Array.isArray(payload.data)) {
    throw new Error('模型与规格数据格式无效');
  }
  if (!isObject(payload.supported_endpoint)) {
    throw new Error('端点数据格式无效');
  }

  const endpoints = Object.fromEntries(
    Object.entries(payload.supported_endpoint).map(([endpointType, info]) => {
      if (!isObject(info)) {
        throw new Error(`${endpointType} 端点格式无效`);
      }
      return [
        endpointType,
        {
          endpointType,
          label: ENDPOINT_LABELS[endpointType] || endpointType,
          path: requireString(info.path, `${endpointType}.path`),
          method: requireString(
            info.method,
            `${endpointType}.method`,
          ).toUpperCase(),
        },
      ];
    }),
  );

  const models = payload.data
    .map(normalizeModel)
    .sort((left, right) => left.modelName.localeCompare(right.modelName));

  return {
    models,
    endpoints,
    pricingVersion:
      typeof payload.pricing_version === 'string'
        ? payload.pricing_version.trim()
        : '',
  };
};

export const normalizeOpenApiDocument = (document) => {
  if (
    !isObject(document) ||
    !isObject(document.info) ||
    !isObject(document.paths)
  ) {
    throw new Error('OpenAPI 文档格式无效');
  }
  return {
    title: requireString(document.info.title, 'OpenAPI info.title'),
    version: requireString(document.info.version, 'OpenAPI info.version'),
    description:
      typeof document.info.description === 'string'
        ? document.info.description.trim()
        : '',
    paths: Object.entries(document.paths).map(([path, operations]) => ({
      path,
      methods: isObject(operations)
        ? Object.keys(operations).map((method) => method.toUpperCase())
        : [],
    })),
    document,
  };
};

export const resolveDefaultEndpointType = (model) => {
  const preferred = PREFERRED_ENDPOINTS_BY_KIND[model.modelKind] || [];
  const matched = preferred.find((endpointType) =>
    model.endpointTypes.includes(endpointType),
  );
  if (matched) return matched;
  if (model.endpointTypes.length === 1) return model.endpointTypes[0];
  return '';
};

const parseImageQuality = (spec) => {
  const parts = spec?.specKey?.split(':') || [];
  return parts[0] === 'image' && parts.length >= 3 ? parts[2] : '';
};

const parseVideoResolution = (spec) => {
  const resolution = spec?.resolution || '';
  if (resolution.endsWith('+sound')) {
    return {
      resolution: resolution.slice(0, -6),
      audio: true,
      videoRef: false,
    };
  }
  if (resolution.endsWith('+video')) {
    return {
      resolution: resolution.slice(0, -6),
      audio: false,
      videoRef: true,
    };
  }
  return { resolution, audio: false, videoRef: false };
};

const requestBodyForEndpoint = (endpointType, modelName, spec) => {
  switch (endpointType) {
    case 'openai':
      return {
        model: modelName,
        messages: [{ role: 'user', content: '你好，请介绍你的能力。' }],
        stream: false,
      };
    case 'openai-response':
      return { model: modelName, input: '你好，请介绍你的能力。' };
    case 'openai-response-compact':
      return { model: modelName, input: '需要压缩的上下文' };
    case 'anthropic':
      return {
        model: modelName,
        max_tokens: 1024,
        messages: [{ role: 'user', content: '你好，请介绍你的能力。' }],
      };
    case 'gemini':
      return { contents: [{ parts: [{ text: '你好，请介绍你的能力。' }] }] };
    case 'jina-rerank':
      return {
        model: modelName,
        query: '人工智能创作平台',
        documents: ['TapCanvas 是 AI 创作平台。', '今天的天气很好。'],
      };
    case 'embeddings':
      return { model: modelName, input: '需要向量化的文本' };
    case 'image-generation': {
      const body = {
        model: modelName,
        prompt: '一张具有电影感的未来城市夜景',
        n: 1,
      };
      if (spec?.resolution) body.resolution = spec.resolution;
      const quality = parseImageQuality(spec);
      if (quality) body.quality = quality;
      return body;
    }
    case 'openai-video': {
      const body = { model: modelName, prompt: '一段电影感的城市夜景推进镜头' };
      const videoSpec = parseVideoResolution(spec);
      if (videoSpec.resolution) body.resolution = videoSpec.resolution;
      if (spec?.durationSeconds) body.duration = spec.durationSeconds;
      if (videoSpec.resolution === 'std' || videoSpec.resolution === 'pro') {
        body.mode = videoSpec.resolution;
      }
      if (videoSpec.audio) body.metadata = { audio: true };
      if (videoSpec.videoRef) body.input_reference = 'REFERENCE_VIDEO_URL';
      return body;
    }
    case 'audio-speech':
      return {
        model: modelName,
        input: '欢迎使用我们的统一模型接口。',
        voice: 'VOICE_ID',
        response_format: 'mp3',
      };
    default:
      throw new Error(`暂不支持为端点 ${endpointType} 生成请求体`);
  }
};

const resolveEndpointPath = (path, modelName) =>
  path.replace('{model}', encodeURIComponent(modelName));

export const buildCurl = ({ baseUrl, model, endpointType, endpoint, spec }) => {
  const normalizedBaseUrl = requireString(baseUrl, 'BASE_URL').replace(
    /\/$/,
    '',
  );
  if (!endpointType || !endpoint) {
    throw new Error('请先选择该模型的调用接口');
  }
  const body = requestBodyForEndpoint(endpointType, model.modelName, spec);
  const requestPath = resolveEndpointPath(endpoint.path, model.modelName);
  return [
    `curl --request ${endpoint.method} '${normalizedBaseUrl}${requestPath}' \\`,
    `  --header 'Authorization: Bearer $API_KEY' \\`,
    `  --header 'Content-Type: application/json' \\`,
    `  --data '${JSON.stringify(body, null, 2)}'`,
  ].join('\n');
};

export const describeSpec = (spec) => {
  if (!spec) return '默认规格';
  const dimensions = [
    spec.resolution || '',
    spec.durationSeconds ? `${spec.durationSeconds}s` : '',
  ].filter(Boolean);
  const price =
    spec.priceDisplayCny ||
    (spec.priceCny > 0 ? `¥${spec.priceCny.toFixed(6)}` : '价格未配置');
  return `${dimensions.join(' · ') || spec.specKey} · ${price}`;
};

export const resolveCnyPriceDisplay = (model, spec) => {
  if (spec) {
    if (spec.priceDisplayCny) {
      return {
        label: '当前规格预计消耗',
        amount: spec.priceDisplayCny,
        detail: `${spec.specKey} · 单次成功请求`,
        fixed: true,
      };
    }
    if (spec.priceCny > 0) {
      return {
        label: '当前规格预计消耗',
        amount: `¥${spec.priceCny.toFixed(6)}`,
        detail: `${spec.specKey} · 单次成功请求`,
        fixed: true,
      };
    }
    return {
      label: '当前规格预计消耗',
      amount: '人民币价格未配置',
      detail: `${spec.specKey} 暂无有效的人民币价格`,
      fixed: false,
    };
  }

  if (model.quotaType === 1 && model.modelPrice > 0) {
    return {
      label: '当前模型预计消耗',
      amount: `¥${model.modelPrice.toFixed(6)}`,
      detail: '固定人民币单次价格',
      fixed: true,
    };
  }

  return {
    label: '当前模型预计消耗',
    amount: '按实际 Token 用量计费',
    detail: '该模型没有固定单次人民币价格，最终金额以成功响应的实际用量为准',
    fixed: false,
  };
};

const describeModelPrice = (model) => {
  if (model.specs.length > 0) return `${model.specs.length} 个动态规格`;
  if (model.quotaType === 1 && model.modelPrice > 0) {
    return `按次 ¥${model.modelPrice.toFixed(6)}`;
  }
  return `倍率计费 ${model.modelRatio}`;
};

export const buildFullDocumentation = ({ catalog, openApi, baseUrl }) => {
  const lines = [
    `# ${openApi.title}`,
    '',
    `- OpenAPI 版本：${openApi.version}`,
    `- BASE_URL：${baseUrl.replace(/\/$/, '')}`,
    '- 鉴权：`Authorization: Bearer $API_KEY`',
    '- 实时模型：`GET /v1/models`',
    '- 实时价格与规格：`GET /api/pricing`',
    '',
    '## 可用端点',
    '',
  ];

  Object.values(catalog.endpoints)
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((endpoint) => {
      lines.push(
        `- ${endpoint.method} \`${endpoint.path}\` — ${endpoint.label}`,
      );
    });

  lines.push('', '## 当前模型、规格与可执行示例', '');
  catalog.models.forEach((model) => {
    lines.push(
      `### ${model.modelName}`,
      '',
      `- 类型：${model.modelKind || '未配置'}`,
      `- 接口：${model.endpointTypes.join(', ') || '未配置'}`,
      `- 计费：${describeModelPrice(model)}`,
    );
    if (model.description) lines.push(`- 说明：${model.description}`);
    if (model.specs.length > 0) {
      lines.push('- 规格：');
      model.specs.forEach((spec) => {
        lines.push(`  - \`${spec.specKey}\`：${describeSpec(spec)}`);
      });
    }

    const endpointType = resolveDefaultEndpointType(model);
    const endpoint = catalog.endpoints[endpointType];
    if (!endpointType || !endpoint) {
      lines.push('', '> 此模型需要先明确选择调用接口，未生成猜测性示例。', '');
      return;
    }
    lines.push(
      '',
      '```bash',
      buildCurl({
        baseUrl,
        model,
        endpointType,
        endpoint,
        spec: model.specs[0] || null,
      }),
      '```',
      '',
    );
  });

  lines.push(
    '',
    '## OpenAPI 完整定义',
    '',
    '以下 JSON 是当前站点实际提供的完整中继接口定义：',
    '',
    '```json',
    JSON.stringify(openApi.document, null, 2),
    '```',
    '',
  );

  return lines.join('\n');
};
