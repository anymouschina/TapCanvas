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

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Button,
  Space,
  Typography,
  Input,
  TextArea,
  Banner,
} from '@douyinfe/semi-ui';
import { API, copy, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const CodexOAuthModal = ({ visible, onCancel, onSuccess, channelId }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState('');
  const [input, setInput] = useState('');
  const [credential, setCredential] = useState('');
  const [selectedFileNames, setSelectedFileNames] = useState([]);
  const fileInputRef = useRef(null);

  const endpoint = (suffix) =>
    channelId
      ? `/api/channel/${channelId}/codex/${suffix}`
      : `/api/channel/codex/${suffix}`;

  const startOAuth = async () => {
    setLoading(true);
    try {
      const res = await API.post(
        endpoint('oauth/start'),
        {},
        { skipErrorHandler: true },
      );
      if (!res?.data?.success) {
        console.error('Codex OAuth start failed:', res?.data?.message);
        throw new Error(t('启动授权失败'));
      }
      const url = res?.data?.data?.authorize_url || '';
      if (!url) {
        console.error(
          'Codex OAuth start response missing authorize_url:',
          res?.data,
        );
        throw new Error(t('响应缺少授权链接'));
      }
      setAuthorizeUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      showSuccess(t('已打开授权页面'));
    } catch (error) {
      showError(error?.message || t('启动授权失败'));
    } finally {
      setLoading(false);
    }
  };

  const completeOAuth = async () => {
    if (!input || !input.trim()) {
      showError(t('请先粘贴回调 URL'));
      return;
    }

    setLoading(true);
    try {
      const res = await API.post(
        endpoint('oauth/complete'),
        { input },
        { skipErrorHandler: true },
      );
      if (!res?.data?.success) {
        console.error('Codex OAuth complete failed:', res?.data?.message);
        throw new Error(t('授权失败'));
      }

      const key = res?.data?.data?.key || '';
      if (!channelId && !key) {
        console.error('Codex OAuth complete response missing key:', res?.data);
        throw new Error(t('响应缺少凭据'));
      }

      onSuccess && onSuccess(key, res?.data?.data);
      showSuccess(channelId ? t('账号已添加') : t('已生成授权凭据'));
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('授权失败'));
    } finally {
      setLoading(false);
    }
  };

  const importCredential = async () => {
    const raw = credential.trim();
    if (!raw) {
      showError(t('请粘贴账号 JSON'));
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error(t('账号凭据必须是 JSON 对象'));
      }
      const compact = JSON.stringify(parsed);
      setLoading(true);
      if (channelId) {
        const res = await API.post(
          `/api/channel/${channelId}/codex/accounts`,
          { credential: compact },
          { skipErrorHandler: true },
        );
        if (!res?.data?.success) {
          throw new Error(res?.data?.message || t('账号导入失败'));
        }
        onSuccess && onSuccess('', res?.data?.data);
      } else {
        const res = await API.post(
          '/api/channel/codex/credentials/normalize',
          { credential: compact },
          { skipErrorHandler: true },
        );
        if (!res?.data?.success) {
          throw new Error(res?.data?.message || t('账号导入失败'));
        }
        onSuccess &&
          onSuccess(res.data.data?.key || '', {
            imported: true,
            importedCount: res.data.data?.account_count || 0,
          });
      }
      showSuccess(t('账号已添加'));
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('账号导入失败'));
    } finally {
      setLoading(false);
    }
  };

  const parseCredentialFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      throw new Error(t('{{name}} 不是 JSON 文件', { name: file.name }));
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error(t('{{name}} 超过 2MB 限制', { name: file.name }));
    }
    const raw = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(t('{{name}} 不是合法 JSON', { name: file.name }));
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(
        t('{{name}} 必须包含一个账号 JSON 对象', { name: file.name }),
      );
    }
    return JSON.stringify(parsed);
  };

  const importCredentialFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    setLoading(true);
    setSelectedFileNames(files.map((file) => file.name));
    try {
      const credentials = await Promise.all(files.map(parseCredentialFile));
      if (channelId) {
        const res = await API.post(
          `/api/channel/${channelId}/codex/accounts`,
          { credentials },
          { skipErrorHandler: true },
        );
        if (!res?.data?.success) {
          throw new Error(res?.data?.message || t('账号文件导入失败'));
        }
        onSuccess && onSuccess('', res?.data?.data);
        showSuccess(
          t(
            '导入完成：新增 {{added}}，更新 {{replaced}}，共 {{total}} 个账号',
            {
              added: res.data.data?.added_count || 0,
              replaced: res.data.data?.replaced_count || 0,
              total: res.data.data?.account_count || 0,
            },
          ),
        );
      } else {
        const res = await API.post(
          '/api/channel/codex/credentials/normalize',
          { credentials },
          { skipErrorHandler: true },
        );
        if (!res?.data?.success) {
          throw new Error(res?.data?.message || t('账号文件导入失败'));
        }
        onSuccess &&
          onSuccess(res.data.data?.key || '', {
            imported: true,
            importedCount: res.data.data?.account_count || 0,
          });
        showSuccess(
          t('已读取 {{count}} 个账号', {
            count: res.data.data?.account_count || 0,
          }),
        );
      }
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('账号文件导入失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setAuthorizeUrl('');
    setInput('');
    setCredential('');
    setSelectedFileNames([]);
  }, [visible]);

  return (
    <Modal
      title={t('Codex 授权')}
      visible={visible}
      onCancel={onCancel}
      maskClosable={false}
      closeOnEsc
      width={720}
      footer={
        <Space>
          <Button theme='borderless' onClick={onCancel} disabled={loading}>
            {t('取消')}
          </Button>
          <Button
            theme='solid'
            type='primary'
            onClick={completeOAuth}
            loading={loading}
          >
            {t('生成并填入')}
          </Button>
        </Space>
      }
    >
      <Space vertical spacing='tight' style={{ width: '100%' }}>
        <Banner
          type='info'
          description={t(
            '1) 点击「打开授权页面」完成登录；2) 浏览器会跳转到 localhost（页面打不开也没关系）；3) 复制地址栏完整 URL 粘贴到下方；4) 点击「生成并填入」。',
          )}
        />

        <Space wrap>
          <Button type='primary' onClick={startOAuth} loading={loading}>
            {t('打开授权页面')}
          </Button>
          <Button
            theme='outline'
            disabled={!authorizeUrl || loading}
            onClick={() => copy(authorizeUrl)}
          >
            {t('复制授权链接')}
          </Button>
        </Space>

        <Input
          value={input}
          onChange={(value) => setInput(value)}
          placeholder={t('请粘贴完整回调 URL（包含 code 与 state）')}
          showClear
        />

        <Text type='tertiary' size='small'>
          {t(
            '说明：生成结果是可直接粘贴到渠道密钥里的 JSON（包含 access_token / refresh_token / account_id）。',
          )}
        </Text>

        <Banner
          type='warning'
          description={t(
            '也可以直接粘贴 sub2api、CLIProxyAPI 或 Codex 导出的账号 JSON；sub2api 备份可包含多个 OpenAI OAuth 账号。敏感凭据仅提交到当前 new-api。',
          )}
        />
        <TextArea
          value={credential}
          onChange={(value) => setCredential(value)}
          placeholder={t('粘贴包含 access_token 与 account_id 的账号 JSON')}
          autosize={{ minRows: 4, maxRows: 10 }}
        />
        <Button
          type='primary'
          theme='outline'
          onClick={importCredential}
          loading={loading}
        >
          {t('一键添加账号')}
        </Button>

        <input
          ref={fileInputRef}
          className='codex-account-json-file-input'
          type='file'
          accept='application/json,.json'
          multiple
          hidden
          onChange={importCredentialFiles}
        />
        <Button
          type='primary'
          theme='outline'
          onClick={() => fileInputRef.current?.click()}
          loading={loading}
        >
          {t('导入本地 JSON 文件')}
        </Button>
        <Text type='tertiary' size='small'>
          {selectedFileNames.length > 0
            ? t('已选择：{{names}}', { names: selectedFileNames.join('、') })
            : t('支持多选与 sub2api 多账号备份；单文件不超过 2MB')}
        </Text>
      </Space>
    </Modal>
  );
};

export default CodexOAuthModal;
