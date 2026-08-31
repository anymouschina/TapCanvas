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

import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import {
  IconCheckCircleStroked,
  IconCopy,
  IconKey,
} from '@douyinfe/semi-icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { copy, showSuccess } from '../../helpers';

const HomeHero = ({ serverAddress, status, user }) => {
  const { t } = useTranslation();
  const statusLoaded = Boolean(status);
  const registerEnabled = status?.register_enabled === true;
  const primaryTarget = user
    ? '/console/topup'
    : registerEnabled
      ? '/register?next=/console/topup'
      : '/login?next=/console/topup';

  const handleCopyBaseUrl = async () => {
    const copied = await copy(serverAddress);
    if (copied) {
      showSuccess(t('接口地址已复制'));
    }
  };

  return (
    <section className='tc-home-hero' aria-labelledby='tc-home-title'>
      <div className='tc-home-hero__content'>
        <div className='tc-home-hero__eyebrow'>
          <span className='tc-home-hero__eyebrow-dot' aria-hidden='true' />
          <span className='tc-home-hero__eyebrow-text'>
            {t('统一 AI 模型基础设施')}
          </span>
        </div>

        <div className='tc-home-hero__copy'>
          <h1 className='tc-home-hero__title' id='tc-home-title'>
            {t('稳定、快速、可观测的大模型接口')}
          </h1>
          <p className='tc-home-hero__description'>
            {t(
              '一个入口连接主流模型。首页指标全部来自近 24 小时真实调用记录。',
            )}
          </p>
        </div>

        <div className='tc-home-endpoint' aria-label={t('API 接入地址')}>
          <div className='tc-home-endpoint__meta'>
            <span className='tc-home-endpoint__label'>{t('API 基址')}</span>
            <span className='tc-home-endpoint__protocol'>HTTPS</span>
          </div>
          <div className='tc-home-endpoint__value-row'>
            <code className='tc-home-endpoint__value'>{serverAddress}</code>
            <Button
              className='tc-home-endpoint__copy'
              theme='borderless'
              type='tertiary'
              icon={<IconCopy className='tc-home-endpoint__copy-icon' />}
              onClick={handleCopyBaseUrl}
              aria-label={t('复制 API 基址')}
            />
          </div>
        </div>

        <div className='tc-home-hero__actions'>
          {statusLoaded && (
            <Link className='tc-home-hero__primary-link' to={primaryTarget}>
              <Button
                className='tc-home-hero__primary-action'
                theme='solid'
                type='primary'
                icon={
                  user ? (
                    <IconKey className='tc-home-hero__action-icon' />
                  ) : (
                    <IconKey className='tc-home-hero__action-icon' />
                  )
                }
              >
                {user
                  ? t('兑换额度')
                  : registerEnabled
                    ? t('注册并开始使用')
                    : t('登录后使用')}
              </Button>
            </Link>
          )}
          <Link className='tc-home-hero__secondary-link' to='/pricing'>
            <Button
              className='tc-home-hero__secondary-action'
              theme='light'
              type='tertiary'
            >
              {t('查看模型与价格')}
            </Button>
          </Link>
        </div>

        {statusLoaded && (
          <div className='tc-home-capabilities' aria-label={t('服务能力')}>
            <span className='tc-home-capability'>
              <IconCheckCircleStroked className='tc-home-capability__icon' />
              <span className='tc-home-capability__text'>
                {registerEnabled ? t('用户注册开放') : t('用户注册暂停')}
              </span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
};

export default HomeHero;
