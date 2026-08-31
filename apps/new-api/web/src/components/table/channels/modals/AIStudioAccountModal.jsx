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
  Input,
  Modal,
  Space,
  Table,
  TabPane,
  Tag,
  Tabs,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const initialForm = {
  name: '',
  proxy: '',
  note: '',
};

const initialLoginForm = {
  email: '',
  password: '',
  recoveryEmail: '',
  totpSecret: '',
};

const AIStudioAccountModal = ({ visible, onCancel, channelId }) => {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [storageState, setStorageState] = useState(null);
  const [fileName, setFileName] = useState('');

  const loadAccounts = async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const response = await API.get(
        `/api/channel/${channelId}/aistudio/accounts`,
        {
          skipErrorHandler: true,
        },
      );
      if (!response?.data?.success) {
        throw new Error(
          response?.data?.message || t('读取 AI Studio 账号池失败'),
        );
      }
      setAccounts(response.data.data?.accounts || []);
    } catch (error) {
      showError(error?.message || t('读取 AI Studio 账号池失败'));
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setForm(initialForm);
      setLoginForm(initialLoginForm);
      setStorageState(null);
      setFileName('');
      loadAccounts();
    }
  }, [visible, channelId]);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showError(t('storageState 文件不能超过 2MB'));
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('storageState 必须是 JSON 对象'));
      }
      if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) {
        throw new Error(t('storageState 必须包含非空 cookies 数组'));
      }
      setStorageState(parsed);
      setFileName(file.name);
    } catch (error) {
      setStorageState(null);
      setFileName('');
      showError(error?.message || t('storageState JSON 无效'));
    }
  };

  const importAccount = async () => {
    if (!form.name.trim() || !form.proxy.trim() || !storageState) {
      showError(t('请填写账号名称、专属代理并选择 storageState JSON'));
      return;
    }
    setImporting(true);
    try {
      const response = await API.post(
        `/api/channel/${channelId}/aistudio/accounts`,
        {
          name: form.name.trim(),
          proxy: form.proxy.trim(),
          note: form.note.trim(),
          storage_state: storageState,
        },
        { skipErrorHandler: true },
      );
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('AI Studio 账号导入失败'));
      }
      showSuccess(t('AI Studio 账号导入成功'));
      setForm(initialForm);
      setStorageState(null);
      setFileName('');
      await loadAccounts();
    } catch (error) {
      showError(error?.message || t('AI Studio 账号导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const onboardAccount = async () => {
    if (
      !form.name.trim() ||
      !form.proxy.trim() ||
      !loginForm.email.trim() ||
      !loginForm.password
    ) {
      showError(t('请填写账号名称、专属代理、Google 邮箱和密码'));
      return;
    }
    setOnboarding(true);
    try {
      const response = await API.post(
        `/api/channel/${channelId}/aistudio/onboard`,
        {
          name: form.name.trim(),
          email: loginForm.email.trim(),
          password: loginForm.password,
          recovery_email: loginForm.recoveryEmail.trim(),
          totp_secret: loginForm.totpSecret.trim(),
          proxy: form.proxy.trim(),
          note: form.note.trim(),
        },
        { skipErrorHandler: true },
      );
      if (!response?.data?.success) {
        throw new Error(
          response?.data?.message || t('AI Studio 自动登录导入失败'),
        );
      }
      showSuccess(t('账号已登录并导入，等待 Runtime 验证 Session'));
      setForm(initialForm);
      setLoginForm(initialLoginForm);
      await loadAccounts();
    } catch (error) {
      showError(error?.message || t('AI Studio 自动登录导入失败'));
    } finally {
      setOnboarding(false);
    }
  };

  const columns = [
    { title: '#', dataIndex: 'index', width: 64 },
    { title: t('账号名称'), dataIndex: 'name' },
    {
      title: t('状态'),
      dataIndex: 'expired',
      width: 100,
      render: (expired) =>
        expired === true ? (
          <Tag color='red'>{t('已失效')}</Tag>
        ) : expired === false ? (
          <Tag color='green'>{t('可用')}</Tag>
        ) : (
          <Tag color='grey'>{t('待运行时验证')}</Tag>
        ),
    },
    { title: t('Cookie 数'), dataIndex: 'cookies', width: 100 },
    {
      title: t('专属代理'),
      dataIndex: 'proxy',
      render: (proxy) =>
        proxy ? (
          <Text code>{proxy}</Text>
        ) : (
          <Tag color='red'>{t('未绑定')}</Tag>
        ),
    },
    { title: t('备注'), dataIndex: 'note' },
  ];

  return (
    <Modal
      title={t('AI Studio 账号池')}
      visible={visible}
      onCancel={onCancel}
      width={920}
      maskClosable={false}
      footer={<Button onClick={onCancel}>{t('关闭')}</Button>}
    >
      <Space vertical spacing='medium' style={{ width: '100%' }}>
        <Banner
          type='info'
          closeIcon={null}
          description={t(
            '优先使用自动登录：Importer 会在 aistudio-to-api 容器内启动一次无头浏览器，并使用该账号的专属代理完成登录。登录成功后密码和 2FA 不保存；服务器 Runtime 继续负责 Session 维护、账号轮询和 429 冷却。',
          )}
        />
        <Banner
          type='warning'
          closeIcon={null}
          description={t(
            '强制一号一 IP：新账号必须填写专属代理，相同代理主机不能被其他账号复用。导入成功只表示文件已落盘，账号最终可用性由服务器 Runtime 验证。',
          )}
        />

        <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
          <Input
            value={form.name}
            onChange={(value) =>
              setForm((current) => ({ ...current, name: value }))
            }
            placeholder={t('账号名称，例如 studio-jp-01')}
            showClear
          />
          <Input
            value={form.proxy}
            onChange={(value) =>
              setForm((current) => ({ ...current, proxy: value }))
            }
            placeholder={t('代理，例如 IP:端口:用户名:密码')}
            showClear
          />
          <Input
            value={form.note}
            onChange={(value) =>
              setForm((current) => ({ ...current, note: value }))
            }
            placeholder={t('备注（可选）')}
            maxLength={255}
            showClear
          />
        </div>

        <Tabs type='button' defaultActiveKey='automatic'>
          <TabPane tab={t('自动登录并导入')} itemKey='automatic'>
            <Space vertical spacing='tight' style={{ width: '100%' }}>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                <Input
                  value={loginForm.email}
                  onChange={(value) =>
                    setLoginForm((current) => ({ ...current, email: value }))
                  }
                  placeholder={t('Google 登录邮箱')}
                  autoComplete='off'
                />
                <Input
                  mode='password'
                  value={loginForm.password}
                  onChange={(value) =>
                    setLoginForm((current) => ({ ...current, password: value }))
                  }
                  placeholder={t('Google 登录密码（不保存）')}
                  autoComplete='new-password'
                />
                <Input
                  value={loginForm.recoveryEmail}
                  onChange={(value) =>
                    setLoginForm((current) => ({
                      ...current,
                      recoveryEmail: value,
                    }))
                  }
                  placeholder={t('恢复邮箱（可选）')}
                  autoComplete='off'
                />
                <Input
                  mode='password'
                  value={loginForm.totpSecret}
                  onChange={(value) =>
                    setLoginForm((current) => ({
                      ...current,
                      totpSecret: value,
                    }))
                  }
                  placeholder={t('2FA TOTP Base32 密钥（可选，不保存）')}
                  autoComplete='off'
                />
              </div>
              <Text type='tertiary'>
                {t(
                  'Google 出现验证码、短信、推送确认、Passkey 或人工风控时会明确失败，不会假装导入成功。',
                )}
              </Text>
              <Button
                type='primary'
                loading={onboarding}
                onClick={onboardAccount}
              >
                {t('自动登录、验证并加入账号池')}
              </Button>
            </Space>
          </TabPane>
          <TabPane tab={t('导入已有 storageState')} itemKey='storage-state'>
            <Space wrap>
              <input
                ref={fileInputRef}
                type='file'
                accept='.json,application/json'
                hidden
                onChange={handleFile}
              />
              <Button
                theme='outline'
                onClick={() => fileInputRef.current?.click()}
              >
                {t('选择 storageState JSON')}
              </Button>
              <Text type={storageState ? 'success' : 'tertiary'}>
                {fileName || t('尚未选择文件，单文件不超过 2MB')}
              </Text>
              <Button
                type='primary'
                loading={importing}
                onClick={importAccount}
              >
                {t('导入账号并绑定专属 IP')}
              </Button>
            </Space>
          </TabPane>
        </Tabs>

        <Table
          columns={columns}
          dataSource={accounts}
          rowKey='file'
          loading={loading}
          pagination={false}
          empty={t('暂无已导入账号')}
        />
      </Space>
    </Modal>
  );
};

export default AIStudioAccountModal;
