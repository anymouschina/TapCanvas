/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import React from 'react';
import { IconCopy } from '@douyinfe/semi-icons';
import { describeSpec, resolveCnyPriceDisplay } from './apiDocs';

const ModelCurlExplorer = ({
  catalog,
  selectedModelName,
  selectedEndpointType,
  selectedSpecKey,
  curl,
  curlError,
  onModelChange,
  onEndpointChange,
  onSpecChange,
  onCopyCurl,
}) => {
  const model = catalog.models.find(
    (candidate) => candidate.modelName === selectedModelName,
  );

  if (!model) {
    return (
      <div className='tc-api-docs__inline-error' role='alert'>
        当前模型不存在，请重新加载实时目录。
      </div>
    );
  }

  const selectedSpec =
    model.specs.find((spec) => spec.specKey === selectedSpecKey) || null;
  const cnyPrice = resolveCnyPriceDisplay(model, selectedSpec);

  return (
    <section
      className='tc-api-docs__explorer'
      aria-labelledby='curl-explorer-title'
    >
      <div className='tc-api-docs__section-heading'>
        <div className='tc-api-docs__heading-copy'>
          <p className='tc-api-docs__eyebrow'>动态请求生成器</p>
          <h2 className='tc-api-docs__section-title' id='curl-explorer-title'>
            选择模型与规格，生成可执行 curl
          </h2>
        </div>
        <div className='tc-api-docs__selected-status'>
          <span className='tc-api-docs__kind-label'>
            {model.modelKind || '类型未配置'}
          </span>
          <span className='tc-api-docs__price-label'>
            {model.specs.length > 0
              ? `${model.specs.length} 个规格`
              : model.quotaType === 1
                ? `¥${model.modelPrice.toFixed(6)} / 次`
                : `倍率 ${model.modelRatio}`}
          </span>
        </div>
      </div>

      <div className='tc-api-docs__controls'>
        <label className='tc-api-docs__field'>
          <span className='tc-api-docs__field-label'>模型</span>
          <select
            className='tc-api-docs__select'
            value={selectedModelName}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {catalog.models.map((candidate) => (
              <option
                className='tc-api-docs__option'
                key={candidate.modelName}
                value={candidate.modelName}
              >
                {candidate.modelName}
              </option>
            ))}
          </select>
        </label>

        <label className='tc-api-docs__field'>
          <span className='tc-api-docs__field-label'>调用接口</span>
          <select
            className='tc-api-docs__select'
            value={selectedEndpointType}
            onChange={(event) => onEndpointChange(event.target.value)}
          >
            {model.endpointTypes.length > 1 && !selectedEndpointType ? (
              <option className='tc-api-docs__option' value=''>
                请选择接口
              </option>
            ) : null}
            {model.endpointTypes.map((endpointType) => (
              <option
                className='tc-api-docs__option'
                key={endpointType}
                value={endpointType}
              >
                {catalog.endpoints[endpointType]?.label || endpointType}
              </option>
            ))}
          </select>
        </label>

        <label className='tc-api-docs__field'>
          <span className='tc-api-docs__field-label'>规格</span>
          <select
            className='tc-api-docs__select'
            value={selectedSpecKey}
            disabled={model.specs.length === 0}
            onChange={(event) => onSpecChange(event.target.value)}
          >
            {model.specs.length === 0 ? (
              <option className='tc-api-docs__option' value=''>
                默认规格
              </option>
            ) : (
              model.specs.map((spec) => (
                <option
                  className='tc-api-docs__option'
                  key={spec.specKey}
                  value={spec.specKey}
                >
                  {describeSpec(spec)}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className='tc-api-docs__price-strip' aria-live='polite'>
        <div className='tc-api-docs__price-summary'>
          <span className='tc-api-docs__price-title'>{cnyPrice.label}</span>
          <strong
            className={`tc-api-docs__price-amount${cnyPrice.fixed ? '' : ' tc-api-docs__price-amount--variable'}`}
          >
            {cnyPrice.amount}
          </strong>
        </div>
        <span className='tc-api-docs__price-detail'>{cnyPrice.detail}</span>
      </div>

      <div className='tc-api-docs__request-meta'>
        <span className='tc-api-docs__request-path'>
          {selectedEndpointType && catalog.endpoints[selectedEndpointType]
            ? `${catalog.endpoints[selectedEndpointType].method} ${catalog.endpoints[selectedEndpointType].path}`
            : '尚未选择调用接口'}
        </span>
        <button
          className='tc-api-docs__copy-curl'
          type='button'
          disabled={!curl}
          onClick={onCopyCurl}
          aria-label='复制当前 curl'
          title='复制当前 curl'
        >
          <IconCopy className='tc-api-docs__button-icon' aria-hidden='true' />
          <span className='tc-api-docs__button-label'>复制 curl</span>
        </button>
      </div>

      {curlError ? (
        <div className='tc-api-docs__inline-error' role='alert'>
          {curlError}
        </div>
      ) : (
        <pre className='tc-api-docs__code' tabIndex='0'>
          <code className='tc-api-docs__code-content'>{curl}</code>
        </pre>
      )}
    </section>
  );
};

export default ModelCurlExplorer;
