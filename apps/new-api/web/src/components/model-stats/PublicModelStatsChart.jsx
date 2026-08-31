/*
Copyright (C) 2025 QuantumNous
Licensed under the GNU Affero General Public License v3 or later.
*/

import React, { useEffect, useMemo, useState } from 'react';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API } from '../../helpers';
import {
  buildModelChartRows,
  filterModelChartPayloadByCategory,
  normalizePublicModelCatalogPayload,
  normalizePublicModelChartPayload,
  summarizeModelChartRows,
} from './modelStatsData';
import './public-model-stats-chart.css';

const CATEGORY_LABELS = {
  all: '全部模型',
  text: '文本模型',
  video: '视频模型',
  image: '图片模型',
};

const formatInteger = (value) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);

const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;

const PublicModelStatsChart = ({
  catalog = null,
  category = 'all',
  titleId = 'public-model-stats-chart-title',
}) => {
  const [metric, setMetric] = useState('calls');
  const [selectedSpecKey, setSelectedSpecKey] = useState('all');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    setError('');
    const catalogRequest = catalog
      ? Promise.resolve(catalog)
      : API.get('/api/pricing', { signal: abortController.signal }).then(
          (response) => normalizePublicModelCatalogPayload(response.data),
        );

    Promise.all([
      API.get('/api/stats/public/models', {
        signal: abortController.signal,
      }),
      catalogRequest,
    ])
      .then(([statsResponse, resolvedCatalog]) => {
        setPayload(
          normalizePublicModelChartPayload(statsResponse.data, resolvedCatalog),
        );
      })
      .catch((requestError) => {
        if (abortController.signal.aborted) return;
        setPayload(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : '全模型运行指标加载失败',
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });
    return () => abortController.abort();
  }, [catalog, reloadKey]);

  const filteredPayload = useMemo(
    () =>
      payload ? filterModelChartPayloadByCategory(payload, category) : null,
    [category, payload],
  );

  useEffect(() => {
    if (!filteredPayload) return;
    setSelectedSpecKey((current) =>
      current === 'all' ||
      filteredPayload.specOptions.some((option) => option.specKey === current)
        ? current
        : 'all',
    );
  }, [filteredPayload]);

  const rows = useMemo(
    () =>
      filteredPayload
        ? buildModelChartRows(filteredPayload.models, metric, selectedSpecKey)
        : [],
    [filteredPayload, metric, selectedSpecKey],
  );
  const summary = useMemo(() => summarizeModelChartRows(rows), [rows]);
  const categoryLabel = CATEGORY_LABELS[category] || CATEGORY_LABELS.all;
  const generatedAt = filteredPayload
    ? new Date(filteredPayload.generatedAt * 1000).toLocaleString('zh-CN')
    : '';

  return (
    <section className='tc-public-model-chart' aria-labelledby={titleId}>
      <div className='tc-public-model-chart__heading'>
        <div className='tc-public-model-chart__heading-copy'>
          <p className='tc-public-model-chart__eyebrow'>真实运行数据</p>
          <h2 className='tc-public-model-chart__title' id={titleId}>
            全模型运行柱状图
          </h2>
          <p className='tc-public-model-chart__description'>
            最近 24 小时成功率与调用量，按真实请求规格拆分；当前显示
            {categoryLabel}。
          </p>
        </div>
        {filteredPayload ? (
          <div className='tc-public-model-chart__summary' aria-label='图表汇总'>
            <span className='tc-public-model-chart__summary-item'>
              {filteredPayload.models.length} 个模型
            </span>
            <span className='tc-public-model-chart__summary-item'>
              {formatInteger(summary.callCount)} 次调用
            </span>
            <span className='tc-public-model-chart__summary-item'>
              {summary.callCount > 0
                ? `${formatPercentage(summary.successRate)} 成功`
                : '暂无样本'}
            </span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className='tc-public-model-chart__state' aria-live='polite'>
          <span
            className='tc-public-model-chart__loading-indicator'
            aria-hidden='true'
          />
          <span className='tc-public-model-chart__loading-text'>
            正在聚合全模型运行数据…
          </span>
        </div>
      ) : error ? (
        <div
          className='tc-public-model-chart__state tc-public-model-chart__state--error'
          role='alert'
        >
          <div className='tc-public-model-chart__error-copy'>
            <strong className='tc-public-model-chart__error-title'>
              全模型运行指标加载失败
            </strong>
            <span className='tc-public-model-chart__error-message'>
              {error}
            </span>
          </div>
          <button
            className='tc-public-model-chart__retry'
            type='button'
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <IconRefresh
              className='tc-public-model-chart__retry-icon'
              aria-hidden='true'
            />
            <span className='tc-public-model-chart__retry-label'>重新加载</span>
          </button>
        </div>
      ) : filteredPayload ? (
        <div className='tc-public-model-chart__content'>
          <div className='tc-public-model-chart__controls'>
            <div
              className='tc-public-model-chart__metric-switch'
              role='group'
              aria-label='切换统计维度'
            >
              <button
                className={`tc-public-model-chart__metric-button${
                  metric === 'calls'
                    ? ' tc-public-model-chart__metric-button--active'
                    : ''
                }`}
                type='button'
                aria-pressed={metric === 'calls'}
                onClick={() => setMetric('calls')}
              >
                调用量
              </button>
              <button
                className={`tc-public-model-chart__metric-button${
                  metric === 'success'
                    ? ' tc-public-model-chart__metric-button--active'
                    : ''
                }`}
                type='button'
                aria-pressed={metric === 'success'}
                onClick={() => setMetric('success')}
              >
                成功率
              </button>
            </div>
            <label className='tc-public-model-chart__spec-field'>
              <span className='tc-public-model-chart__field-label'>
                调用规格
              </span>
              <select
                className='tc-public-model-chart__spec-select'
                value={selectedSpecKey}
                onChange={(event) => setSelectedSpecKey(event.target.value)}
              >
                <option className='tc-public-model-chart__option' value='all'>
                  全部规格（聚合）
                </option>
                {filteredPayload.specOptions.map((option) => (
                  <option
                    className='tc-public-model-chart__option'
                    key={option.specKey}
                    value={option.specKey}
                  >
                    {option.specLabel}
                  </option>
                ))}
              </select>
            </label>
            <time
              className='tc-public-model-chart__updated'
              dateTime={new Date(
                filteredPayload.generatedAt * 1000,
              ).toISOString()}
            >
              更新于 {generatedAt}
            </time>
          </div>

          {rows.length === 0 ? (
            <div className='tc-public-model-chart__state' role='status'>
              <span className='tc-public-model-chart__empty-text'>
                当前分类没有已发布模型。
              </span>
            </div>
          ) : (
            <div
              className='tc-public-model-chart__bar-chart'
              role='img'
              aria-label={`${categoryLabel}${
                metric === 'calls' ? '调用量' : '成功率'
              }柱状图`}
            >
              <div
                className='tc-public-model-chart__bar-header'
                aria-hidden='true'
              >
                <span className='tc-public-model-chart__bar-column'>模型</span>
                <span className='tc-public-model-chart__bar-column'>
                  相对柱长
                </span>
                <span className='tc-public-model-chart__bar-column tc-public-model-chart__bar-column--value'>
                  {metric === 'calls' ? '调用量' : '成功率 / 样本'}
                </span>
              </div>
              <div className='tc-public-model-chart__bar-rows'>
                {rows.map((row) => (
                  <div
                    className='tc-public-model-chart__bar-row'
                    key={row.modelName}
                  >
                    <div className='tc-public-model-chart__bar-model'>
                      <span className='tc-public-model-chart__bar-model-name'>
                        {row.modelName}
                      </span>
                      <span className='tc-public-model-chart__bar-model-kind'>
                        {row.modelKind || '未分类'}
                      </span>
                    </div>
                    <div className='tc-public-model-chart__bar-track'>
                      <span
                        className={`tc-public-model-chart__bar-fill tc-public-model-chart__bar-fill--${metric}`}
                        style={{ width: `${row.barPercentage}%` }}
                      />
                    </div>
                    <span className='tc-public-model-chart__bar-value'>
                      {metric === 'calls'
                        ? formatInteger(row.callCount)
                        : row.callCount > 0
                          ? `${formatPercentage(row.successRate)} / ${formatInteger(row.callCount)}`
                          : '暂无样本'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default PublicModelStatsChart;
