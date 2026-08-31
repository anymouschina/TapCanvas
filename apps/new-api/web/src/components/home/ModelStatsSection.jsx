/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Skeleton } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { API } from '../../helpers';
import { useTranslation } from 'react-i18next';

const HEALTH_LABEL_KEYS = {
  operational: '运行正常',
  degraded: '轻微波动',
  unstable: '服务波动',
  unavailable: '当前不可用',
  no_data: '暂无样本',
};

const MODEL_CATEGORIES = [
  { value: 'all', labelKey: '全部' },
  { value: 'text', labelKey: '文本' },
  { value: 'video', labelKey: '视频' },
  { value: 'image', labelKey: '图片' },
];

const formatDuration = (seconds) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  if (value < 10) return `${value.toFixed(1)} s`;
  return `${Math.round(value)} s`;
};

const formatCompactNumber = (value) =>
  new Intl.NumberFormat(undefined, { notation: 'compact' }).format(
    Number(value) || 0,
  );

const formatInteger = (value) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Number(value) || 0,
  );

const getSuccessRate = (model) =>
  model.call_count > 0
    ? Math.round((model.success_count / model.call_count) * 1000) / 10
    : 0;

const getSpecification = (model, t) => {
  const configured = Array.isArray(model.specifications)
    ? model.specifications.filter(Boolean)
    : [];
  if (configured.length > 0) {
    return configured.join(' / ');
  }

  const kind = model.model_kind ? t(model.model_kind) : t('通用模型');
  const promptTokens = Number(model.average_prompt_tokens) || 0;
  const completionTokens = Number(model.average_completion_tokens) || 0;
  if (promptTokens <= 0 && completionTokens <= 0) {
    return kind;
  }
  return `${kind} · ${t('输入')} ≈${formatInteger(promptTokens)} / ${t('输出')} ≈${formatInteger(completionTokens)} tokens`;
};

const ModelStatsSkeleton = () => (
  <div className='tc-model-stats__skeleton' aria-label='loading'>
    {Array.from({ length: 6 }).map((_, index) => (
      <Skeleton
        className='tc-model-stats__skeleton-row'
        key={index}
        placeholder={
          <Skeleton.Button className='tc-model-stats__skeleton-block' />
        }
        loading
      />
    ))}
  </div>
);

const ModelStatsSection = ({ activeCategory, onCategoryChange }) => {
  const { t } = useTranslation();
  const requestSequence = useRef(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setError('');
    setPayload(null);
    try {
      const response = await API.get('/api/stats/public', {
        params: { category: activeCategory },
      });
      const { success, data, message } = response.data;
      if (!success) {
        throw new Error(message || t('运行指标接口返回失败'));
      }
      if (
        !data ||
        data.category !== activeCategory ||
        !Array.isArray(data.models)
      ) {
        throw new Error(t('运行指标数据格式无效'));
      }
      if (requestSequence.current !== requestId) return;
      setPayload(data);
    } catch (requestError) {
      if (requestSequence.current !== requestId) return;
      setPayload(null);
      setError(requestError?.message || t('无法读取运行指标'));
    } finally {
      if (requestSequence.current === requestId) {
        setLoading(false);
      }
    }
  }, [activeCategory, t]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const models = useMemo(() => {
    if (!Array.isArray(payload?.models)) return [];
    return [...payload.models]
      .sort((left, right) => {
        const countDifference =
          Number(right.call_count || 0) - Number(left.call_count || 0);
        if (countDifference !== 0) return countDifference;
        return String(left.model_name).localeCompare(String(right.model_name));
      })
      .slice(0, 10);
  }, [payload]);
  const summary = useMemo(() => {
    const totalCalls = models.reduce(
      (total, model) => total + Number(model.call_count || 0),
      0,
    );
    const successCalls = models.reduce(
      (total, model) => total + Number(model.success_count || 0),
      0,
    );
    const weightedLatency = models.reduce(
      (total, model) =>
        total +
        Number(model.average_latency_seconds || 0) *
          Number(model.call_count || 0),
      0,
    );
    return {
      totalCalls,
      successRate:
        totalCalls > 0
          ? Math.round((successCalls / totalCalls) * 1000) / 10
          : 0,
      averageLatency: totalCalls > 0 ? weightedLatency / totalCalls : 0,
      availableModels: models.filter((model) => model.available).length,
    };
  }, [models]);

  const generatedAt = payload?.generated_at
    ? new Date(payload.generated_at * 1000).toLocaleString()
    : '';

  return (
    <section className='tc-model-stats' aria-labelledby='tc-model-stats-title'>
      <div className='tc-model-stats__header'>
        <div className='tc-model-stats__heading'>
          <span className='tc-model-stats__kicker'>{t('公开运行指标')}</span>
          <h2 className='tc-model-stats__title' id='tc-model-stats-title'>
            {t('近 24 小时调用量 Top 10')}
          </h2>
          <p className='tc-model-stats__description'>
            {t(
              '耗时、规格与状态均来自网关真实调用和当前模型配置，不使用演示数据。',
            )}
          </p>
        </div>
        {generatedAt && (
          <div className='tc-model-stats__updated'>
            <span className='tc-model-stats__updated-label'>
              {t('更新时间')}
            </span>
            <time
              className='tc-model-stats__updated-value'
              dateTime={new Date(payload.generated_at * 1000).toISOString()}
            >
              {generatedAt}
            </time>
          </div>
        )}
      </div>

      <div
        className='tc-model-categories'
        role='group'
        aria-label={t('切换模型分类')}
      >
        {MODEL_CATEGORIES.map((category) => (
          <button
            className={`tc-model-categories__item${
              activeCategory === category.value
                ? ' tc-model-categories__item--active'
                : ''
            }`}
            key={category.value}
            type='button'
            aria-pressed={activeCategory === category.value}
            onClick={() => onCategoryChange(category.value)}
          >
            <span className='tc-model-categories__label'>
              {t(category.labelKey)}
            </span>
          </button>
        ))}
      </div>

      {!loading && !error && models.length > 0 && (
        <div className='tc-model-summary' aria-label={t('运行指标摘要')}>
          <div className='tc-model-summary__item'>
            <span className='tc-model-summary__label'>{t('Top 10 调用')}</span>
            <strong className='tc-model-summary__value'>
              {formatCompactNumber(summary.totalCalls)}
            </strong>
          </div>
          <div className='tc-model-summary__item'>
            <span className='tc-model-summary__label'>{t('综合成功率')}</span>
            <strong className='tc-model-summary__value'>
              {summary.successRate}%
            </strong>
          </div>
          <div className='tc-model-summary__item'>
            <span className='tc-model-summary__label'>{t('加权平均耗时')}</span>
            <strong className='tc-model-summary__value'>
              {formatDuration(summary.averageLatency)}
            </strong>
          </div>
          <div className='tc-model-summary__item'>
            <span className='tc-model-summary__label'>{t('当前可用')}</span>
            <strong className='tc-model-summary__value'>
              {summary.availableModels}/{models.length}
            </strong>
          </div>
        </div>
      )}

      {loading ? (
        <ModelStatsSkeleton />
      ) : error ? (
        <div className='tc-model-state tc-model-state--error' role='alert'>
          <div className='tc-model-state__copy'>
            <strong className='tc-model-state__title'>
              {t('运行指标加载失败')}
            </strong>
            <span className='tc-model-state__description'>{error}</span>
          </div>
          <Button
            className='tc-model-state__action'
            theme='light'
            type='tertiary'
            icon={<IconRefresh className='tc-model-state__action-icon' />}
            onClick={fetchStats}
          >
            {t('重新加载')}
          </Button>
        </div>
      ) : models.length === 0 ? (
        <div className='tc-model-state' role='status'>
          <div className='tc-model-state__copy'>
            <strong className='tc-model-state__title'>
              {t('近 24 小时暂无调用样本')}
            </strong>
            <span className='tc-model-state__description'>
              {t('产生真实模型调用后，这里将按调用量展示前十名。')}
            </span>
          </div>
        </div>
      ) : (
        <div className='tc-model-table-wrap'>
          <table className='tc-model-table'>
            <thead className='tc-model-table__head'>
              <tr className='tc-model-table__row tc-model-table__row--head'>
                <th className='tc-model-table__cell tc-model-table__cell--rank'>
                  #
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--model'>
                  {t('模型')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--spec'>
                  {t('使用规格')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--number'>
                  {t('调用')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--number'>
                  {t('平均耗时')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--number tc-model-table__cell--max'>
                  {t('最高耗时')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--number'>
                  {t('成功率')}
                </th>
                <th className='tc-model-table__cell tc-model-table__cell--status'>
                  {t('状态')}
                </th>
              </tr>
            </thead>
            <tbody className='tc-model-table__body'>
              {models.map((model, index) => (
                <tr className='tc-model-table__row' key={model.model_name}>
                  <td className='tc-model-table__cell tc-model-table__cell--rank'>
                    {String(index + 1).padStart(2, '0')}
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--model'>
                    <span className='tc-model-table__model-name'>
                      {model.model_name}
                    </span>
                  </td>
                  <td
                    className='tc-model-table__cell tc-model-table__cell--spec'
                    title={getSpecification(model, t)}
                  >
                    {getSpecification(model, t)}
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--number'>
                    {formatCompactNumber(model.call_count)}
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--number'>
                    {formatDuration(model.average_latency_seconds)}
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--number tc-model-table__cell--max'>
                    {formatDuration(model.maximum_latency_seconds)}
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--number'>
                    {getSuccessRate(model)}%
                  </td>
                  <td className='tc-model-table__cell tc-model-table__cell--status'>
                    <span
                      className={`tc-health-status tc-health-status--${model.health_status || 'no_data'}`}
                    >
                      <span
                        className='tc-health-status__dot'
                        aria-hidden='true'
                      />
                      <span className='tc-health-status__text'>
                        {t(
                          HEALTH_LABEL_KEYS[model.health_status] ||
                            HEALTH_LABEL_KEYS.no_data,
                        )}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ModelStatsSection;
