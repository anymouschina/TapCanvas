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
  Banner,
  Button,
  Modal,
  Space,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const VertexAccountModal = ({
  visible,
  channelId,
  keyType,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [credential, setCredential] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFileNames, setSelectedFileNames] = useState([]);
  const fileInputRef = useRef(null);
  const isApiKey = keyType === 'api_key';

  useEffect(() => {
    if (!visible) return;
    setCredential('');
    setSelectedFileNames([]);
  }, [visible]);

  const importCredentials = async (credentials) => {
    if (!channelId) {
      throw new Error(t('请先选择 Vertex AI 多账号渠道'));
    }
    const response = await API.post(
      `/api/channel/${channelId}/vertex/accounts`,
      { credentials },
      { skipErrorHandler: true },
    );
    if (!response?.data?.success) {
      throw new Error(response?.data?.message || t('Vertex AI 账号导入失败'));
    }
    const result = response.data.data || {};
    showSuccess(
      t('导入完成：新增 {{added}}，更新 {{replaced}}，共 {{total}} 个账号', {
        added: result.added_count || 0,
        replaced: result.replaced_count || 0,
        total: result.account_count || 0,
      }),
    );
    if (onSuccess) {
      await onSuccess(result);
    }
    onCancel && onCancel();
  };

  const importPastedCredential = async () => {
    const raw = credential.trim();
    if (!raw) {
      showError(
        isApiKey
          ? t('请粘贴至少一个 Vertex AI API Key')
          : t('请粘贴服务账号 JSON 或 JSON 数组'),
      );
      return;
    }
    setLoading(true);
    try {
      await importCredentials([raw]);
    } catch (error) {
      showError(error?.message || t('Vertex AI 账号导入失败'));
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
      await importCredentials(credentials);
    } catch (error) {
      showError(error?.message || t('Vertex AI 账号文件导入失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('Vertex AI 账号导入')}
      visible={visible}
      onCancel={onCancel}
      maskClosable={false}
      width={720}
      footer={
        <Space>
          <Button theme='borderless' onClick={onCancel} disabled={loading}>
            {t('取消')}
          </Button>
          <Button
            theme='solid'
            type='primary'
            onClick={importPastedCredential}
            loading={loading}
          >
            {t('导入账号')}
          </Button>
        </Space>
      }
    >
      <Space vertical spacing='loose' style={{ width: '100%' }}>
        <Banner
          type='info'
          closeIcon={null}
          description={
            isApiKey
              ? t(
                  '当前渠道使用 Vertex AI API Key。每行粘贴一个 Key；导入后由当前 new-api 直接请求 Google 官方 Vertex AI，不经过其他 new-api 服务。',
                )
              : t(
                  '当前渠道使用 Google Cloud 服务账号。可粘贴一个完整 JSON、JSON 数组，或批量选择服务账号 JSON 文件；本地将为每个账号签发 JWT 并向 Google 换取访问令牌。',
                )
          }
        />
        <TextArea
          value={credential}
          onChange={setCredential}
          placeholder={
            isApiKey
              ? t('每行一个 Vertex AI API Key')
              : t('粘贴服务账号 JSON 对象或 JSON 数组')
          }
          autosize={{ minRows: 8, maxRows: 18 }}
        />
        <Space wrap>
          <input
            ref={fileInputRef}
            className='vertex-account-file-input'
            type='file'
            accept={isApiKey ? 'text/plain,.txt' : 'application/json,.json'}
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
            {isApiKey ? t('批量导入 Key 文件') : t('批量导入服务账号 JSON')}
          </Button>
          <Text type='tertiary' size='small'>
            {selectedFileNames.length > 0
              ? t('已选择：{{names}}', {
                  names: selectedFileNames.join('、'),
                })
              : isApiKey
                ? t('支持 TXT 文件，每行一个 API Key；单个文件不超过 2MB')
                : t('支持服务账号 JSON 文件；单个文件不超过 2MB')}
          </Text>
        </Space>
      </Space>
    </Modal>
  );
};

export default VertexAccountModal;
