import React, { useEffect, useState } from 'react';
import { Progress, Skeleton, Typography } from '@douyinfe/semi-ui';
import {
  IllustrationConstruction,
  IllustrationConstructionDark,
} from '@douyinfe/semi-illustrations';
import { API } from '../../helpers';
import { useActualTheme } from '../../context/Theme';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

const getSuccessRateColor = (rate) => {
  if (rate >= 95) return '#10b981';
  if (rate >= 80) return '#f59e0b';
  return '#ef4444';
};

const ModelStatCard = ({ modelName, callCount, successCount }) => {
  const { t } = useTranslation();
  const rate = callCount > 0 ? Math.round((successCount / callCount) * 100) : 0;
  const color = getSuccessRateColor(rate);

  return (
    <div className='rounded-xl border border-semi-color-border bg-semi-color-bg-1 p-4 flex flex-col gap-3'>
      <Text strong ellipsis={{ showTooltip: true }} className='!text-sm'>
        {modelName}
      </Text>
      <div className='flex items-baseline gap-1'>
        <Title heading={3} className='!mb-0 !leading-none'>
          {callCount.toLocaleString()}
        </Title>
        <Text type='tertiary' size='small'>{t('次')}</Text>
      </div>
      <div className='flex flex-col gap-1'>
        <div className='flex justify-between'>
          <Text type='tertiary' size='small'>{t('成功率')}</Text>
          <Text size='small' style={{ color }}>{rate}%</Text>
        </div>
        <Progress
          percent={rate}
          showInfo={false}
          strokeColor={color}
          size='small'
        />
      </div>
    </div>
  );
};

const ModelStatsSection = () => {
  const { t } = useTranslation();
  const actualTheme = useActualTheme();
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await API.get('/api/stats/public');
        const { success, data } = res.data;
        if (success && Array.isArray(data)) {
          setStats(data);
        }
      } catch (_) {
        // 静默失败，展示空态
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className='w-full border-t border-semi-color-border px-4 py-12 md:py-16'>
      <div className='max-w-5xl mx-auto'>
        <div className='flex items-center justify-center mb-8'>
          <Text
            type='tertiary'
            className='text-lg md:text-xl lg:text-2xl font-light'
          >
            {t('过去 24 小时 · 模型调用概览')}
          </Text>
        </div>

        {loading ? (
          <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton
                key={i}
                placeholder={
                  <Skeleton.Button
                    style={{ width: '100%', height: 120, borderRadius: 12 }}
                  />
                }
                loading
              />
            ))}
          </div>
        ) : stats.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8'>
            {actualTheme === 'dark' ? (
              <IllustrationConstructionDark style={{ width: 120, height: 120 }} />
            ) : (
              <IllustrationConstruction style={{ width: 120, height: 120 }} />
            )}
            <Text type='tertiary' className='mt-4'>
              {t('暂无数据')}
            </Text>
          </div>
        ) : (
          <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
            {stats.map((item) => (
              <ModelStatCard
                key={item.model_name}
                modelName={item.model_name}
                callCount={item.call_count}
                successCount={item.success_count}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelStatsSection;
