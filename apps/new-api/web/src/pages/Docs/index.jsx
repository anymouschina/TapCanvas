/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API, copy, showError, showSuccess } from '../../helpers';
import DocsToolbar from './DocsToolbar';
import ModelCurlExplorer from './ModelCurlExplorer';
import ModelStatsChart from './ModelStatsChart';
import {
  buildCurl,
  buildFullDocumentation,
  normalizeOpenApiDocument,
  normalizePricingPayload,
  resolveDefaultEndpointType,
} from './apiDocs';
import './docs.css';

const DocsPage = () => {
  const [catalog, setCatalog] = useState(null);
  const [openApi, setOpenApi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedModelName, setSelectedModelName] = useState('');
  const [selectedEndpointType, setSelectedEndpointType] = useState('');
  const [selectedSpecKey, setSelectedSpecKey] = useState('');
  const baseUrl = window.location.origin;

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    setLoadError('');

    Promise.all([
      API.get('/api/pricing', { signal: abortController.signal }),
      API.get('/openapi/relay.json', { signal: abortController.signal }),
    ])
      .then(([pricingResponse, openApiResponse]) => {
        const nextCatalog = normalizePricingPayload(pricingResponse.data);
        const nextOpenApi = normalizeOpenApiDocument(openApiResponse.data);
        if (nextCatalog.models.length === 0) {
          throw new Error('实时模型目录为空');
        }
        const firstModel = nextCatalog.models[0];
        setCatalog(nextCatalog);
        setOpenApi(nextOpenApi);
        setSelectedModelName(firstModel.modelName);
        setSelectedEndpointType(resolveDefaultEndpointType(firstModel));
        setSelectedSpecKey(firstModel.specs[0]?.specKey || '');
      })
      .catch((error) => {
        if (abortController.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : 'API 文档数据加载失败';
        setLoadError(message);
        setCatalog(null);
        setOpenApi(null);
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [reloadKey]);

  const selectedModel = useMemo(
    () =>
      catalog?.models.find((model) => model.modelName === selectedModelName) ||
      null,
    [catalog, selectedModelName],
  );

  const selectedSpec = useMemo(
    () =>
      selectedModel?.specs.find((spec) => spec.specKey === selectedSpecKey) ||
      null,
    [selectedModel, selectedSpecKey],
  );

  const curlResult = useMemo(() => {
    if (!catalog || !selectedModel) return { curl: '', error: '' };
    try {
      return {
        curl: buildCurl({
          baseUrl,
          model: selectedModel,
          endpointType: selectedEndpointType,
          endpoint: catalog.endpoints[selectedEndpointType],
          spec: selectedSpec,
        }),
        error: '',
      };
    } catch (error) {
      return {
        curl: '',
        error: error instanceof Error ? error.message : 'curl 生成失败',
      };
    }
  }, [baseUrl, catalog, selectedEndpointType, selectedModel, selectedSpec]);

  const specCount = useMemo(
    () =>
      catalog?.models.reduce((total, model) => total + model.specs.length, 0) ||
      0,
    [catalog],
  );

  const handleModelChange = useCallback(
    (modelName) => {
      const nextModel = catalog?.models.find(
        (model) => model.modelName === modelName,
      );
      if (!nextModel) {
        showError('所选模型已不在实时目录中');
        return;
      }
      setSelectedModelName(nextModel.modelName);
      setSelectedEndpointType(resolveDefaultEndpointType(nextModel));
      setSelectedSpecKey(nextModel.specs[0]?.specKey || '');
    },
    [catalog],
  );

  const handleCopy = useCallback(async (content, successMessage) => {
    if (!content) {
      showError('没有可复制的内容');
      return;
    }
    const copied = await copy(content);
    if (!copied) {
      showError('复制失败，请检查浏览器剪贴板权限');
      return;
    }
    showSuccess(successMessage);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (!catalog || !openApi) {
      showError('动态文档尚未加载完成');
      return;
    }
    try {
      const fullDocumentation = buildFullDocumentation({
        catalog,
        openApi,
        baseUrl,
      });
      handleCopy(fullDocumentation, '全部 API 文档已复制，可直接交给 AI 配置');
    } catch (error) {
      showError(error instanceof Error ? error.message : '完整文档生成失败');
    }
  }, [baseUrl, catalog, handleCopy, openApi]);

  return (
    <main className='tc-api-docs'>
      <DocsToolbar
        modelCount={catalog?.models.length || 0}
        specCount={specCount}
        disabled={loading || Boolean(loadError) || !catalog || !openApi}
        onCopyAll={handleCopyAll}
      />

      <div className='tc-api-docs__content'>
        <section className='tc-api-docs__hero' aria-labelledby='api-docs-title'>
          <div className='tc-api-docs__hero-copy'>
            <p className='tc-api-docs__eyebrow'>站内 API 文档</p>
            <h1 className='tc-api-docs__title' id='api-docs-title'>
              一个地址，接入全部模型
            </h1>
            <p className='tc-api-docs__description'>
              模型、规格、价格与端点均来自当前网关实时配置。选择后直接复制
              curl， 无需离开本站，也不会展示演示数据。
            </p>
          </div>
          <div className='tc-api-docs__quick-start'>
            <div className='tc-api-docs__quick-row'>
              <span className='tc-api-docs__quick-label'>BASE_URL</span>
              <code className='tc-api-docs__quick-value'>{baseUrl}</code>
            </div>
            <div className='tc-api-docs__quick-row'>
              <span className='tc-api-docs__quick-label'>鉴权</span>
              <code className='tc-api-docs__quick-value'>Bearer $API_KEY</code>
            </div>
            <div className='tc-api-docs__quick-row'>
              <span className='tc-api-docs__quick-label'>模型发现</span>
              <code className='tc-api-docs__quick-value'>GET /v1/models</code>
            </div>
          </div>
        </section>

        {loading ? (
          <section className='tc-api-docs__loading' aria-live='polite'>
            <span
              className='tc-api-docs__loading-indicator'
              aria-hidden='true'
            />
            <span className='tc-api-docs__loading-text'>
              正在读取实时模型与规格…
            </span>
          </section>
        ) : loadError ? (
          <section className='tc-api-docs__load-error' role='alert'>
            <div className='tc-api-docs__error-copy'>
              <h2 className='tc-api-docs__error-title'>API 文档数据加载失败</h2>
              <p className='tc-api-docs__error-message'>{loadError}</p>
            </div>
            <button
              className='tc-api-docs__retry'
              type='button'
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <IconRefresh
                className='tc-api-docs__button-icon'
                aria-hidden='true'
              />
              <span className='tc-api-docs__button-label'>重新加载</span>
            </button>
          </section>
        ) : catalog && openApi ? (
          <div className='tc-api-docs__loaded-content'>
            <ModelCurlExplorer
              catalog={catalog}
              selectedModelName={selectedModelName}
              selectedEndpointType={selectedEndpointType}
              selectedSpecKey={selectedSpecKey}
              curl={curlResult.curl}
              curlError={curlResult.error}
              onModelChange={handleModelChange}
              onEndpointChange={setSelectedEndpointType}
              onSpecChange={setSelectedSpecKey}
              onCopyCurl={() => handleCopy(curlResult.curl, '当前 curl 已复制')}
            />

            <ModelStatsChart catalog={catalog} />

            <section
              className='tc-api-docs__endpoint-section'
              aria-labelledby='endpoint-title'
            >
              <div className='tc-api-docs__section-heading'>
                <div className='tc-api-docs__heading-copy'>
                  <p className='tc-api-docs__eyebrow'>实时端点目录</p>
                  <h2
                    className='tc-api-docs__section-title'
                    id='endpoint-title'
                  >
                    当前网关公开能力
                  </h2>
                </div>
                <span className='tc-api-docs__openapi-version'>
                  OpenAPI {openApi.version}
                </span>
              </div>
              <div className='tc-api-docs__endpoint-list'>
                {Object.values(catalog.endpoints)
                  .sort((left, right) => left.path.localeCompare(right.path))
                  .map((endpoint) => (
                    <div
                      className='tc-api-docs__endpoint-row'
                      key={endpoint.endpointType}
                    >
                      <span className='tc-api-docs__endpoint-method'>
                        {endpoint.method}
                      </span>
                      <code className='tc-api-docs__endpoint-path'>
                        {endpoint.path}
                      </code>
                      <span className='tc-api-docs__endpoint-name'>
                        {endpoint.label}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
};

export default DocsPage;
