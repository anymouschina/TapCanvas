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

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Input,
  Modal,
  Space,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showSuccess } from '../../../../helpers';
import { DROID_CHANNEL_TYPE } from '../../../../constants/channel.constants';
import {
  buildApiKeyAppendRequest,
  normalizeApiKeyLines,
} from '../utils/apiKeyImport';

const ApiKeyImportModal = ({ channel, onCancel, onSuccess }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const count = normalizeApiKeyLines(input).length;
  const isDroid = channel?.type === DROID_CHANNEL_TYPE;

  const submit = async () => {
    if (pendingRef.current || count === 0) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const request = buildApiKeyAppendRequest(channel, input, email);
      const res = await API.put('/api/channel/', request, {
        skipErrorHandler: true,
      });
      if (!res.data?.success)
        throw new Error(res.data?.message || t('API Key 添加失败'));
      setInput('');
      setEmail('');
      showSuccess(t('API Key 已追加到号池'));
      await onSuccess();
    } catch (failure) {
      setError(failure.message || t('API Key 添加失败'));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      className='api-key-import-modal'
      visible
      title={isDroid ? t('添加 Droid API Key') : t('添加 API Key')}
      onCancel={() => {
        if (!pendingRef.current) onCancel();
      }}
      maskClosable={!pending}
      closable={!pending}
      width={560}
      footer={
        <Space className='api-key-import-space'>
          <Button
            className='api-key-import-button'
            disabled={pending}
            onClick={onCancel}
          >
            {t('取消')}
          </Button>
          <Button
            className='api-key-import-button'
            theme='solid'
            loading={pending}
            disabled={count === 0}
            onClick={submit}
          >
            {t('追加到号池')}
          </Button>
        </Space>
      }
    >
      <Space
        className='api-key-import-space'
        vertical
        align='start'
        style={{ width: '100%' }}
      >
        <Typography.Text className='api-key-import-typography-text'>
          {channel?.name} (#{channel?.id})
        </Typography.Text>
        <Banner
          className='api-key-import-banner'
          type='info'
          closeIcon={null}
          description={
            isDroid
              ? t(
                  'Factory API Key 每行一条，API Key 不需要 OAuth 刷新。新密钥将追加到现有号池。',
                )
              : t(
                  'API Key 每行一条，重复与空行会自动去除，新密钥将追加到现有号池。',
                )
          }
        />
        <TextArea
          className='api-key-import-text-area'
          aria-label={t('API Key，每行一条')}
          placeholder={
            isDroid
              ? t('请输入 Factory API Key，每行一条')
              : t('请输入 API Key，每行一条')
          }
          value={input}
          disabled={pending}
          onChange={setInput}
          autosize={{ minRows: 5, maxRows: 12 }}
          autoComplete='off'
          spellCheck={false}
          style={{ width: '100%' }}
        />
        <Typography.Text
          className='api-key-import-typography-text'
          type='tertiary'
        >
          {t('待导入 {{count}} 个 API Key', { count })}
        </Typography.Text>
        <div className='api-key-import-email' style={{ width: '100%' }}>
          <Typography.Text className='api-key-import-email-label'>
            {t('账号邮箱（可选）')}
          </Typography.Text>
          <Input
            className='api-key-import-email-input'
            aria-label={t('账号邮箱（可选）')}
            placeholder={t('填写邮箱，方便识别和搜索账号')}
            value={email}
            onChange={setEmail}
            disabled={pending}
            autoComplete='off'
          />
          <Typography.Text
            className='api-key-import-email-help'
            type='tertiary'
            size='small'
          >
            {t(
              '仅作手动备注，不验证登录身份；批量添加时应用到本批所有 API Key。',
            )}
          </Typography.Text>
        </div>
        {error && (
          <Banner
            className='api-key-import-banner'
            type='danger'
            closeIcon={null}
            description={error}
          />
        )}
      </Space>
    </Modal>
  );
};

export default ApiKeyImportModal;
