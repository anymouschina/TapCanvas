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
  Select,
} from '@douyinfe/semi-ui';
import { API, copy, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const OAUTH_TYPES = [
  { value: 'ai_studio', label: 'AI Studio OAuth' },
  { value: 'code_assist', label: 'Code Assist OAuth' },
  { value: 'google_one', label: 'Google One / Code Assist OAuth' },
];

const splitPastedGeminiCredentials = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return [trimmed];
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
};

const GeminiOAuthModal = ({ visible, onCancel, onSuccess, channelId }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [oauthType, setOauthType] = useState('ai_studio');
  const [projectId, setProjectId] = useState('');
  const [tierId, setTierId] = useState('');
  const [email, setEmail] = useState('');
  const [authorizeUrl, setAuthorizeUrl] = useState('');
  const [input, setInput] = useState('');
  const [credential, setCredential] = useState('');
  const [selectedFileNames, setSelectedFileNames] = useState([]);
  const fileInputRef = useRef(null);

  const endpoint = (suffix) =>
    channelId
      ? `/api/channel/${channelId}/gemini/${suffix}`
      : `/api/channel/gemini/${suffix}`;

  const startOAuth = async () => {
    setLoading(true);
    try {
      const res = await API.post(
        endpoint('oauth/start'),
        {
          oauth_type: oauthType,
          project_id: projectId.trim(),
          tier_id: tierId.trim(),
        },
        { skipErrorHandler: true },
      );
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || t('启动授权失败'));
      }
      const url = res?.data?.data?.authorize_url || '';
      if (!url) {
        throw new Error(t('响应缺少授权链接'));
      }
      setAuthorizeUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      showSuccess(t('已打开 Google 授权页面'));
    } catch (error) {
      showError(error?.message || t('启动授权失败'));
    } finally {
      setLoading(false);
    }
  };

  const completeOAuth = async () => {
    if (!input.trim()) {
      showError(t('请先粘贴完整回调 URL 或授权码'));
      return;
    }
    setLoading(true);
    try {
      const res = await API.post(
        endpoint('oauth/complete'),
        { input: input.trim(), email: email.trim() },
        { skipErrorHandler: true },
      );
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || t('授权失败'));
      }
      const key = res?.data?.data?.key || '';
      if (!channelId && !key) {
        throw new Error(t('响应缺少 Gemini OAuth 凭据'));
      }
      if (onSuccess) {
        await onSuccess(key, res?.data?.data);
      }
      showSuccess(
        channelId ? t('Gemini 账号已添加') : t('已生成 Gemini OAuth 凭据'),
      );
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('授权失败'));
    } finally {
      setLoading(false);
    }
  };

  const importCredentials = async (credentials) => {
    const res = await API.post(
      channelId
        ? `/api/channel/${channelId}/gemini/accounts`
        : '/api/channel/gemini/credentials/normalize',
      { credentials },
      { skipErrorHandler: true },
    );
    if (!res?.data?.success) {
      throw new Error(res?.data?.message || t('账号导入失败'));
    }
    const accountCount = res.data.data?.account_count || 0;
    if (onSuccess) {
      await onSuccess(channelId ? '' : res.data.data?.key || '', {
        ...res.data.data,
        imported: true,
        importedCount: accountCount,
      });
    }
    return accountCount;
  };

  const importCredential = async () => {
    const raw = credential.trim();
    if (!raw) {
      showError(t('请粘贴 Gemini API Key、OAuth JSON 或 sub2api 导出'));
      return;
    }
    setLoading(true);
    try {
      const credentials = splitPastedGeminiCredentials(raw);
      const accountCount = await importCredentials(credentials);
      showSuccess(
        t('已导入 {{count}} 个 Gemini 账号', { count: accountCount }),
      );
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('账号导入失败'));
    } finally {
      setLoading(false);
    }
  };

  const importCredentialFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    setLoading(true);
    setSelectedFileNames(files.map((file) => file.name));
    try {
      const credentials = await Promise.all(
        files.map(async (file) => {
          if (file.size > 2 * 1024 * 1024) {
            throw new Error(t('{{name}} 超过 2MB 限制', { name: file.name }));
          }
          const raw = (await file.text()).trim();
          if (!raw) {
            throw new Error(t('{{name}} 为空', { name: file.name }));
          }
          return raw;
        }),
      );
      const accountCount = await importCredentials(credentials);
      showSuccess(
        t('已导入 {{count}} 个 Gemini 账号', { count: accountCount }),
      );
      onCancel && onCancel();
    } catch (error) {
      showError(error?.message || t('账号文件导入失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setOauthType('ai_studio');
    setProjectId('');
    setTierId('');
    setEmail('');
    setAuthorizeUrl('');
    setInput('');
    setCredential('');
    setSelectedFileNames([]);
  }, [visible]);

  const projectRequired =
    oauthType === 'code_assist' || oauthType === 'google_one';

  return (
    <Modal
      title={t('Gemini 账号授权与导入')}
      visible={visible}
      onCancel={onCancel}
      maskClosable={false}
      closeOnEsc
      width={760}
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
            {t('完成 OAuth 授权')}
          </Button>
        </Space>
      }
    >
      <Space vertical spacing='tight' style={{ width: '100%' }}>
        <Banner
          type='info'
          description={t(
            'Gemini 支持 API Key、AI Studio OAuth、Code Assist OAuth，以及 CLIProxyAPI Antigravity RT / OAuth JSON 导入。Antigravity RT 会先换取真实 access token 并校验账号与 project_id，成功后才保存到当前渠道。',
          )}
        />
        <Space wrap>
          <Select
            value={oauthType}
            onChange={setOauthType}
            optionList={OAUTH_TYPES}
            style={{ minWidth: 220 }}
          />
          <Input
            value={projectId}
            onChange={setProjectId}
            placeholder={
              projectRequired
                ? t('Google Cloud Project ID（Code Assist 必填）')
                : t('Project ID（AI Studio 可选）')
            }
            showClear
          />
          <Input
            value={tierId}
            onChange={setTierId}
            placeholder={t('Tier ID（可选）')}
            showClear
          />
        </Space>
        <Space wrap>
          <Button type='primary' onClick={startOAuth} loading={loading}>
            {t('打开 Google 授权页面')}
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
          onChange={setInput}
          placeholder={t(
            '粘贴完整回调 URL（包含 code 与 state），或粘贴 code#state',
          )}
          showClear
        />
        <Input
          value={email}
          onChange={setEmail}
          placeholder={t('账号邮箱/备注（可选，用于账号列表识别）')}
          showClear
        />
        <Text type='tertiary' size='small'>
          {t(
            'Code Assist 回调地址可能无法打开；这是正常的，复制浏览器地址栏中的完整 URL 再粘贴即可。',
          )}
        </Text>
        <TextArea
          value={credential}
          onChange={setCredential}
          placeholder={t(
            '支持每行粘贴一个 Gemini API Key 或以 1// 开头的 Antigravity RT；OAuth JSON / sub2api 导出请保持为完整 JSON',
          )}
          autosize={{ minRows: 4, maxRows: 10 }}
        />
        <Space wrap>
          <Button
            type='primary'
            theme='outline'
            onClick={importCredential}
            loading={loading}
          >
            {t('导入 API Key / JSON')}
          </Button>
          <input
            ref={fileInputRef}
            className='gemini-account-json-file-input'
            type='file'
            accept='application/json,.json,.txt'
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
            {t('导入本地凭据文件')}
          </Button>
        </Space>
        <Text type='tertiary' size='small'>
          {selectedFileNames.length > 0
            ? t('已选择：{{names}}', { names: selectedFileNames.join('、') })
            : t('单个文件不超过 2MB；支持 CLIProxyAPI Antigravity RT / JSON 和 sub2api Gemini OAuth 多账号导出')}
        </Text>
      </Space>
    </Modal>
  );
};

export default GeminiOAuthModal;
