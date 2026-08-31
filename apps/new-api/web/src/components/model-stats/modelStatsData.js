/*
Copyright (C) 2025 QuantumNous
Licensed under the GNU Affero General Public License v3 or later.
*/

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 缺失或格式无效`);
  }
  return value.trim();
};

const requireCount = (value, field) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} 必须是非负整数`);
  }
  return value;
};

const requireRate = (value, field) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`${field} 必须是 0 到 1 之间的数字`);
  }
  return value;
};

const normalizeRuntimeSpec = (entry, modelName, index) => {
  if (!isObject(entry)) {
    throw new Error(`${modelName}.specs[${index}] 格式无效`);
  }
  return {
    specKey: requireString(entry.spec_key, `${modelName}.spec_key`),
    specLabel: requireString(entry.spec_label, `${modelName}.spec_label`),
    callCount: requireCount(entry.call_count, `${modelName}.call_count`),
    successCount: requireCount(
      entry.success_count,
      `${modelName}.success_count`,
    ),
    successRate: requireRate(entry.success_rate, `${modelName}.success_rate`),
  };
};

const normalizeRuntimeModel = (entry, index) => {
  if (!isObject(entry)) {
    throw new Error(`models[${index}] 格式无效`);
  }
  const modelName = requireString(
    entry.model_name,
    `models[${index}].model_name`,
  );
  if (!Array.isArray(entry.specs)) {
    throw new Error(`${modelName}.specs 格式无效`);
  }
  return {
    modelName,
    modelKind:
      typeof entry.model_kind === 'string'
        ? entry.model_kind.trim().toLowerCase()
        : '',
    callCount: requireCount(entry.call_count, `${modelName}.call_count`),
    successCount: requireCount(
      entry.success_count,
      `${modelName}.success_count`,
    ),
    successRate: requireRate(entry.success_rate, `${modelName}.success_rate`),
    specs: entry.specs.map((spec, specIndex) =>
      normalizeRuntimeSpec(spec, modelName, specIndex),
    ),
  };
};

const buildSpecOptions = (models) => {
  const specLabels = new Map();
  models.forEach((model) => {
    model.specs.forEach((spec) => {
      const existing = specLabels.get(spec.specKey);
      if (existing && existing !== spec.specLabel) {
        throw new Error(`规格 ${spec.specKey} 存在冲突标签`);
      }
      specLabels.set(spec.specKey, spec.specLabel);
    });
  });
  return [...specLabels.entries()]
    .map(([specKey, specLabel]) => ({ specKey, specLabel }))
    .sort((left, right) => left.specLabel.localeCompare(right.specLabel));
};

export const normalizePublicModelCatalogPayload = (payload) => {
  if (
    !isObject(payload) ||
    payload.success !== true ||
    !Array.isArray(payload.data)
  ) {
    throw new Error('实时模型目录格式无效');
  }
  const modelsByName = new Map();
  payload.data.forEach((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`实时模型目录第 ${index + 1} 项格式无效`);
    }
    const modelName = requireString(
      entry.model_name,
      `models[${index}].model_name`,
    );
    const modelKind =
      typeof entry.model_kind === 'string'
        ? entry.model_kind.trim().toLowerCase()
        : '';
    modelsByName.set(modelName, { modelName, modelKind });
  });
  return { models: [...modelsByName.values()] };
};

export const normalizePublicModelChartPayload = (payload, catalog) => {
  if (
    !isObject(payload) ||
    payload.success !== true ||
    !isObject(payload.data)
  ) {
    throw new Error('全模型运行指标接口返回失败');
  }
  if (!Array.isArray(payload.data.models)) {
    throw new Error('全模型运行指标数据格式无效');
  }
  if (!catalog || !Array.isArray(catalog.models)) {
    throw new Error('实时模型目录格式无效');
  }
  const generatedAt = requireCount(payload.data.generated_at, 'generated_at');
  const windowHours = requireCount(payload.data.window_hours, 'window_hours');
  if (windowHours === 0) {
    throw new Error('统计窗口必须大于 0');
  }

  const runtimeModels = payload.data.models.map(normalizeRuntimeModel);
  const runtimeByName = new Map(
    runtimeModels.map((model) => [model.modelName, model]),
  );
  const catalogNames = new Set(catalog.models.map((model) => model.modelName));

  const currentModels = catalog.models.map((model) => {
    const runtime = runtimeByName.get(model.modelName);
    return (
      runtime || {
        modelName: model.modelName,
        modelKind: model.modelKind,
        callCount: 0,
        successCount: 0,
        successRate: 0,
        specs: [],
      }
    );
  });
  const observedOutsideCatalog = runtimeModels.filter(
    (model) => !catalogNames.has(model.modelName),
  );
  const models = [...currentModels, ...observedOutsideCatalog];

  return {
    generatedAt,
    windowHours,
    models,
    specOptions: buildSpecOptions(models),
  };
};

const categoryModelKinds = {
  all: null,
  text: new Set(['chat', 'text']),
  video: new Set(['video']),
  image: new Set(['image']),
};

export const filterModelChartPayloadByCategory = (payload, category) => {
  const allowedKinds = categoryModelKinds[category];
  if (allowedKinds === undefined) {
    throw new Error('模型分类参数无效');
  }
  const models = allowedKinds
    ? payload.models.filter((model) => allowedKinds.has(model.modelKind))
    : payload.models;
  return {
    ...payload,
    models,
    specOptions: buildSpecOptions(models),
  };
};

const selectedModelStats = (model, selectedSpecKey) => {
  if (selectedSpecKey === 'all') {
    return {
      callCount: model.callCount,
      successCount: model.successCount,
      successRate: model.successRate,
    };
  }
  const spec = model.specs.find(
    (candidate) => candidate.specKey === selectedSpecKey,
  );
  return spec || { callCount: 0, successCount: 0, successRate: 0 };
};

export const buildModelChartRows = (models, metric, selectedSpecKey) => {
  const rows = models.map((model) => ({
    modelName: model.modelName,
    modelKind: model.modelKind,
    ...selectedModelStats(model, selectedSpecKey),
  }));
  rows.sort((left, right) => {
    if (metric === 'success') {
      const leftHasSample = left.callCount > 0;
      const rightHasSample = right.callCount > 0;
      if (leftHasSample !== rightHasSample) return leftHasSample ? -1 : 1;
      if (left.successRate !== right.successRate) {
        return right.successRate - left.successRate;
      }
    }
    if (left.callCount !== right.callCount) {
      return right.callCount - left.callCount;
    }
    return left.modelName.localeCompare(right.modelName);
  });

  const maximumCalls = Math.max(0, ...rows.map((row) => row.callCount));
  return rows.map((row) => ({
    ...row,
    barPercentage:
      metric === 'success'
        ? row.successRate * 100
        : maximumCalls > 0
          ? (row.callCount / maximumCalls) * 100
          : 0,
  }));
};

export const summarizeModelChartRows = (rows) => {
  const callCount = rows.reduce((total, row) => total + row.callCount, 0);
  const successCount = rows.reduce((total, row) => total + row.successCount, 0);
  return {
    callCount,
    successRate: callCount > 0 ? successCount / callCount : 0,
  };
};
