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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Table,
  Tag,
  Typography,
  Space,
  Button,
  Select,
  Empty,
  Spin,
  Modal,
  Form,
  Input,
  TextArea,
  Banner,
} from '@douyinfe/semi-ui';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { API, copy, showError, showSuccess } from '../../helpers';
import CodexOAuthModal from '../../components/table/channels/modals/CodexOAuthModal';
import GeminiOAuthModal from '../../components/table/channels/modals/GeminiOAuthModal';
import VertexAccountModal from '../../components/table/channels/modals/VertexAccountModal';
import ApiKeyImportModal from '../../components/table/channels/modals/ApiKeyImportModal';
import { accountPageSize, useAccountData } from './useAccountData';
import { useSessionHistory } from './useSessionHistory';
import { createAccountSessionColumns } from './account-columns';
import {
  CODEX_CHANNEL_TYPE,
  GEMINI_CHANNEL_TYPE,
  VERTEX_CHANNEL_TYPE,
  DROID_CHANNEL_TYPE,
} from '../../constants/channel.constants';

const { Text, Title } = Typography;

const getVertexKeyType = (channel) => {
  if (!channel || channel.type !== VERTEX_CHANNEL_TYPE) return 'json';
  if (channel.settings && typeof channel.settings === 'object') {
    return channel.settings.vertex_key_type || 'json';
  }
  if (typeof channel.settings !== 'string' || !channel.settings.trim()) {
    return 'json';
  }
  try {
    const settings = JSON.parse(channel.settings);
    return settings?.vertex_key_type || 'json';
  } catch {
    return 'json';
  }
};

const AccountSessionsPage = () => {
  const { t } = useTranslation();

  // 渠道选择
  const [channels, setChannels] = useState([]); // 仅多 key 渠道
  const [channelLoading, setChannelLoading] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState(null);

  const {
    accounts,
    accountLoading,
    accountPage,
    accountTotal,
    accountStats,
    accountStatus,
    setAccountStatus,
    accountEmail,
    setAccountEmail,
    accountError,
    observedAt,
    loadAccounts,
  } = useAccountData(selectedChannelId);
  const [emailQuery, setEmailQuery] = useState('');
  const [usageRefreshing, setUsageRefreshing] = useState(false);
  const [usageRefreshError, setUsageRefreshError] = useState('');
  const usageRequests = useRef(new Set());
  const usageScope = useRef(selectedChannelId);
  usageScope.current = selectedChannelId;
  const [opLoading, setOpLoading] = useState({});
  const [apiKeyImportVisible, setApiKeyImportVisible] = useState(false);

  // 单账号 chat 可用性测试
  const [chatTestAccount, setChatTestAccount] = useState(null);
  const [chatTestPrompt, setChatTestPrompt] = useState('请只回复：账号可用');
  const [chatTestLoading, setChatTestLoading] = useState(false);
  const [chatTestResult, setChatTestResult] = useState(null);
  const [chatTestError, setChatTestError] = useState('');

  // 添加账号弹窗（贴 JSON）
  const [addVisible, setAddVisible] = useState(false);
  const [addJson, setAddJson] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // OAuth 授权新账号弹窗
  const [oauthVisible, setOauthVisible] = useState(false);
  const [oauthLabel, setOauthLabel] = useState(''); // 账号备注 → 写进 key 的 email 字段
  const [oauthUrl, setOauthUrl] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [codexImportVisible, setCodexImportVisible] = useState(false);
  const [geminiImportVisible, setGeminiImportVisible] = useState(false);
  const [vertexImportVisible, setVertexImportVisible] = useState(false);
  const [codexFilesLoading, setCodexFilesLoading] = useState(false);
  const codexFilesInputRef = useRef(null);

  const {
    sessions,
    sessionLoading,
    sessionError,
    loadSessions,
    sessionLogCount,
    sessionLogTotal,
    hasMoreSessions,
  } = useSessionHistory(selectedChannelId);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId),
    [channels, selectedChannelId],
  );
  const selectedVertexKeyType = useMemo(
    () => getVertexKeyType(selectedChannel),
    [selectedChannel],
  );

  // 加载多 key 渠道列表
  const loadChannels = async () => {
    setChannelLoading(true);
    try {
      const items = [];
      let page = 1;
      let total;
      do {
        const res = await API.get('/api/channel/', {
          params: { p: page, page_size: 100, id_sort: true },
          skipErrorHandler: true,
        });
        if (!res.data?.success)
          throw new Error(res.data?.message || t('加载渠道失败'));
        const batch = res.data.data.items || [];
        total = res.data.data.total;
        if (
          !Number.isInteger(total) ||
          (batch.length === 0 && items.length < total)
        )
          throw new Error(t('渠道分页响应不完整'));
        items.push(...batch);
        page += 1;
      } while (items.length < total);
      const multiKey = items.filter(
        (channel) => channel.channel_info?.is_multi_key,
      );
      setChannels(multiKey);
      setSelectedChannelId((current) =>
        multiKey.some((channel) => channel.id === current)
          ? current
          : (multiKey[0]?.id ?? null),
      );
    } catch (e) {
      showError(e.message || t('加载渠道失败'));
    } finally {
      setChannelLoading(false);
    }
  };

  const refreshAccountLifecycle = async (channelId = selectedChannelId) => {
    if (!channelId || usageRequests.current.has(channelId)) return;
    const channel = channels.find((item) => item.id === channelId);
    const provider = {
      [CODEX_CHANNEL_TYPE]: 'codex',
      [GEMINI_CHANNEL_TYPE]: 'gemini',
      [DROID_CHANNEL_TYPE]: 'droid',
    }[channel?.type];
    if (!provider) {
      await loadAccounts(channelId);
      return;
    }
    usageRequests.current.add(channelId);
    setUsageRefreshing(true);
    setUsageRefreshError('');
    try {
      const response = await API.get(
        `/api/channel/${channelId}/${provider}/usage`,
        { skipErrorHandler: true },
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || t('刷新账号用量失败'));
    } catch (error) {
      if (usageScope.current === channelId) {
        const message = error.message || t('刷新账号用量失败');
        setUsageRefreshError(message);
        showError(message);
      }
    } finally {
      await loadAccounts(channelId);
      usageRequests.current.delete(channelId);
      if (usageScope.current === channelId) setUsageRefreshing(false);
    }
  };

  useEffect(() => {
    setUsageRefreshError('');
    setUsageRefreshing(usageRequests.current.has(selectedChannelId));
    if (selectedChannel?.type === DROID_CHANNEL_TYPE)
      void refreshAccountLifecycle(selectedChannelId);
    // Pagination and filters only read account snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelId, selectedChannel?.type]);

  const parseCodexAccountFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      throw new Error(t('{{name}} 不是 JSON 文件', { name: file.name }));
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error(t('{{name}} 超过 2MB 限制', { name: file.name }));
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
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

  const importCodexAccountFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0 || !selectedChannelId) return;
    setCodexFilesLoading(true);
    try {
      const credentials = await Promise.all(files.map(parseCodexAccountFile));
      const res = await API.post(
        `/api/channel/${selectedChannelId}/codex/accounts`,
        { credentials },
        { skipErrorHandler: true },
      );
      if (!res?.data?.success) {
        throw new Error(res?.data?.message || t('账号文件导入失败'));
      }
      showSuccess(
        t('导入完成：新增 {{added}}，更新 {{replaced}}，共 {{total}} 个账号', {
          added: res.data.data?.added_count || 0,
          replaced: res.data.data?.replaced_count || 0,
          total: res.data.data?.account_count || 0,
        }),
      );
      await loadChannels();
      await refreshAccountLifecycle(selectedChannelId);
    } catch (error) {
      showError(error?.message || t('账号文件导入失败'));
    } finally {
      setCodexFilesLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 启用 / 禁用 / 删除 单个账号
  const keyAction = async (action, keyIndex, successMsg) => {
    const opId = `${action}_${keyIndex}`;
    setOpLoading((p) => ({ ...p, [opId]: true }));
    try {
      const res = await API.post('/api/channel/multi_key/manage', {
        channel_id: selectedChannelId,
        action,
        key_index: keyIndex,
      });
      if (res.data.success) {
        showSuccess(successMsg);
        await loadAccounts();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(t('操作失败'));
    } finally {
      setOpLoading((p) => ({ ...p, [opId]: false }));
    }
  };

  const openChatTest = (account) => {
    setChatTestAccount(account);
    setChatTestPrompt(t('请只回复：账号可用'));
    setChatTestError('');
    setChatTestResult(null);
  };

  const runChatTest = async () => {
    const prompt = chatTestPrompt.trim();
    if (!selectedChannelId || !chatTestAccount || !prompt) {
      showError(t('测试消息不能为空'));
      return;
    }
    setChatTestLoading(true);
    setChatTestResult(null);
    setChatTestError('');
    try {
      const res = await API.post(
        `/api/channel/test/${selectedChannelId}/account-chat`,
        {
          key_index: chatTestAccount.index,
          model: selectedChannel?.test_model || '',
          prompt,
        },
        { skipErrorHandler: true },
      );
      const data = res?.data;
      if (!data?.success) {
        throw new Error(data?.message || t('账号测试失败'));
      }
      let response = data.response || '';
      try {
        response = JSON.stringify(JSON.parse(response), null, 2);
      } catch {
        // 非 JSON 响应按上游原文展示，不做语义兜底或改写。
      }
      setChatTestResult({ response, time: data.time });
      showSuccess(t('账号可用'));
    } catch (error) {
      const message = error?.message || t('账号测试失败');
      setChatTestError(message);
      showError(message);
    } finally {
      setChatTestLoading(false);
    }
  };

  // 把一段 OAuth JSON append 进当前多 key 渠道。overrideEmail 非空时写进 key 的 email
  // 字段（用于「授权时手填备注」让账号可识别）。压成单行避免换行破坏多 key 分隔。返回是否成功。
  const appendKeyJson = async (rawJson, overrideEmail) => {
    let obj;
    try {
      obj = JSON.parse(rawJson);
    } catch (e) {
      showError(t('OAuth JSON 格式错误，无法解析'));
      return false;
    }
    if (overrideEmail && overrideEmail.trim()) {
      obj.email = overrideEmail.trim();
    }
    const minified = JSON.stringify(obj);
    const res = await API.put('/api/channel/', {
      id: selectedChannelId,
      type: selectedChannel?.type,
      key: minified,
      key_mode: 'append',
    });
    if (res.data.success) {
      await loadChannels();
      await loadAccounts();
      return true;
    }
    showError(res.data.message);
    return false;
  };

  const appendGeminiCredentials = async (rawKey, importData) => {
    const credentials = String(rawKey || '')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    if (credentials.length === 0) {
      throw new Error(t('Gemini 凭据为空'));
    }
    const res = await API.post(
      `/api/channel/${selectedChannelId}/gemini/accounts`,
      { credentials },
      { skipErrorHandler: true },
    );
    if (!res?.data?.success) {
      throw new Error(res?.data?.message || t('Gemini 账号添加失败'));
    }
    await loadChannels();
    await loadAccounts(selectedChannelId, 1);
    if (importData?.importedCount) {
      showSuccess(
        t('已处理 {{count}} 个 Gemini 账号', {
          count: importData.importedCount,
        }),
      );
    }
  };

  const handleGeminiModalSuccess = async (key, data) => {
    if (!key && data?.account_count !== undefined) {
      await loadChannels();
      await loadAccounts(selectedChannelId, 1);
      return;
    }
    await appendGeminiCredentials(key, data);
  };

  // 添加账号（贴 OAuth JSON）
  const handleAddAccount = async () => {
    const raw = addJson.trim();
    if (!raw) {
      showError(t('请粘贴 OAuth JSON'));
      return;
    }
    setAddLoading(true);
    try {
      if (await appendKeyJson(raw)) {
        showSuccess(t('账号已添加'));
        setAddVisible(false);
        setAddJson('');
      }
    } catch (e) {
      showError(t('添加账号失败'));
    } finally {
      setAddLoading(false);
    }
  };

  // 打开 OAuth 授权弹窗
  const openOAuth = () => {
    setOauthLabel('');
    setOauthUrl('');
    setOauthCode('');
    setOauthVisible(true);
  };

  // 步骤1：取授权链接并打开 claude.ai 授权页（独立 token，不读本地 CLI 凭证）
  const startOAuth = async () => {
    setOauthLoading(true);
    try {
      const res = await API.post(
        '/api/channel/claude/oauth/start',
        {},
        { skipErrorHandler: true },
      );
      const url = res?.data?.data?.authorize_url || '';
      if (!res?.data?.success || !url) {
        throw new Error(res?.data?.message || t('启动授权失败'));
      }
      setOauthUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      showSuccess(t('已打开授权页面，授权后把授权码粘回下方'));
    } catch (e) {
      showError(e?.message || t('启动授权失败'));
    } finally {
      setOauthLoading(false);
    }
  };

  // 步骤2：用授权码换 token，注入备注，append 进渠道
  const completeOAuth = async () => {
    if (!oauthCode.trim()) {
      showError(t('请先粘贴授权码'));
      return;
    }
    setOauthLoading(true);
    try {
      const res = await API.post(
        '/api/channel/claude/oauth/complete',
        { input: oauthCode.trim() },
        { skipErrorHandler: true },
      );
      const key = res?.data?.data?.key || '';
      if (!res?.data?.success || !key) {
        throw new Error(res?.data?.message || t('授权失败'));
      }
      if (await appendKeyJson(key, oauthLabel)) {
        showSuccess(t('新账号已授权并加入渠道'));
        setOauthVisible(false);
      }
    } catch (e) {
      showError(e?.message || t('授权失败'));
    } finally {
      setOauthLoading(false);
    }
  };

  const { accountColumns, sessionColumns } = createAccountSessionColumns({
    t,
    selectedChannel,
    opLoading,
    openChatTest,
    keyAction,
  });

  const emptyNode = (title, desc) => (
    <Empty
      image={<IllustrationNoResult style={{ width: 140, height: 140 }} />}
      darkModeImage={
        <IllustrationNoResultDark style={{ width: 140, height: 140 }} />
      }
      title={title}
      description={desc}
      style={{ padding: 30 }}
    />
  );

  return (
    <div className='mt-[60px] px-2 flex flex-col gap-4'>
      {/* 渠道选择 */}
      <Card className='!rounded-xl'>
        <div className='flex items-center justify-between flex-wrap gap-3'>
          <Space>
            <Title heading={5} style={{ margin: 0 }}>
              {t('账号会话管理')}
            </Title>
            <Text type='tertiary'>
              {t('管理渠道内的多个账号并查看会话归属')}
            </Text>
          </Space>
          <Space>
            <Text type='tertiary'>{t('渠道')}：</Text>
            <Select
              style={{ minWidth: 240 }}
              loading={channelLoading}
              value={selectedChannelId}
              placeholder={t('请选择多密钥渠道')}
              onChange={(v) => setSelectedChannelId(v)}
              optionList={channels.map((c) => ({
                label: `${c.name} (#${c.id})`,
                value: c.id,
              }))}
            />
            <Button onClick={loadChannels} loading={channelLoading}>
              {t('刷新')}
            </Button>
          </Space>
        </div>
        {!channelLoading && channels.length === 0 && (
          <Banner
            className='mt-3'
            type='warning'
            description={t(
              '未找到多密钥（multi-key）渠道。请先在「渠道管理」中将目标渠道开启多密钥模式。',
            )}
            closeIcon={null}
          />
        )}
      </Card>

      {/* 账号列表 */}
      <Card
        className='!rounded-xl'
        title={
          <Space>
            <Text strong>{t('账号列表')}</Text>
            {selectedChannel?.channel_info?.multi_key_mode && (
              <Tag size='small' shape='circle' color='white'>
                {selectedChannel.channel_info.multi_key_mode === 'random'
                  ? t('随机模式')
                  : t('轮询模式')}
              </Tag>
            )}
            <Tag size='small' shape='circle' color='white'>
              {t('共')} {accountTotal} {t('个账号')}
            </Tag>
          </Space>
        }
        headerExtraContent={
          <Space>
            <Button
              onClick={() => refreshAccountLifecycle()}
              loading={usageRefreshing}
            >
              {selectedChannel?.type === CODEX_CHANNEL_TYPE
                ? t('刷新用量')
                : [GEMINI_CHANNEL_TYPE, DROID_CHANNEL_TYPE].includes(
                      selectedChannel?.type,
                    )
                  ? t('刷新额度')
                  : t('刷新')}
            </Button>
            <Button
              type='primary'
              theme='solid'
              disabled={!selectedChannelId}
              onClick={() =>
                selectedChannel?.type === DROID_CHANNEL_TYPE
                  ? setApiKeyImportVisible(true)
                  : selectedChannel?.type === CODEX_CHANNEL_TYPE
                    ? setCodexImportVisible(true)
                    : selectedChannel?.type === GEMINI_CHANNEL_TYPE
                      ? setGeminiImportVisible(true)
                      : selectedChannel?.type === VERTEX_CHANNEL_TYPE
                        ? setVertexImportVisible(true)
                        : openOAuth()
              }
            >
              {selectedChannel?.type === DROID_CHANNEL_TYPE
                ? t('添加 Droid API Key')
                : selectedChannel?.type === GEMINI_CHANNEL_TYPE
                  ? t('添加 Gemini 账号')
                  : selectedChannel?.type === VERTEX_CHANNEL_TYPE
                    ? t('添加 Vertex AI 账号')
                    : t('授权新账号')}
            </Button>
            {selectedChannel?.type === CODEX_CHANNEL_TYPE && (
              <>
                <input
                  ref={codexFilesInputRef}
                  className='account-sessions-codex-files-input'
                  type='file'
                  accept='application/json,.json'
                  multiple
                  hidden
                  onChange={importCodexAccountFiles}
                />
                <Button
                  type='tertiary'
                  disabled={!selectedChannelId}
                  loading={codexFilesLoading}
                  onClick={() => codexFilesInputRef.current?.click()}
                >
                  {t('批量导入 JSON')}
                </Button>
              </>
            )}
            <Button
              type='tertiary'
              hidden={selectedChannel?.type === DROID_CHANNEL_TYPE}
              disabled={!selectedChannelId}
              onClick={() =>
                selectedChannel?.type === GEMINI_CHANNEL_TYPE
                  ? setGeminiImportVisible(true)
                  : selectedChannel?.type === VERTEX_CHANNEL_TYPE
                    ? setVertexImportVisible(true)
                    : setAddVisible(true)
              }
            >
              {selectedChannel?.type === GEMINI_CHANNEL_TYPE
                ? t('API Key / JSON 添加')
                : selectedChannel?.type === VERTEX_CHANNEL_TYPE
                  ? t('批量导入凭证')
                  : t('贴 JSON 添加')}
            </Button>
          </Space>
        }
      >
        {selectedChannel?.type === DROID_CHANNEL_TYPE && (
          <Banner
            className='droid-account-pool-info'
            type='info'
            closeIcon={null}
            description={t(
              'Droid 号池使用 Factory API Key，按配置的随机或轮询策略调度。上游拒绝额度不足时，会尝试其他已启用账号并保持原模型；若没有账号可用，将显示额度不足原因。API Key 不需要 OAuth 刷新。',
            )}
          />
        )}
        <Space
          className='account-pool-filters'
          wrap
          style={{ marginBottom: 12 }}
        >
          <Input
            className='account-email-search'
            aria-label={t('搜索账号邮箱')}
            value={emailQuery}
            onChange={setEmailQuery}
            onEnterPress={() => setAccountEmail(emailQuery)}
            placeholder={t('搜索账号邮箱')}
          />
          <Button
            className='account-email-search-submit'
            theme='borderless'
            onClick={() => setAccountEmail(emailQuery)}
          >
            {t('搜索')}
          </Button>
          <Select
            className='account-status-filter'
            aria-label={t('账号状态筛选')}
            value={accountStatus ?? 'all'}
            onChange={(value) =>
              setAccountStatus(value === 'all' ? null : value)
            }
            optionList={[
              { value: 'all', label: t('全部状态') },
              { value: 1, label: t('已启用') },
              { value: 2, label: t('手动禁用') },
              { value: 3, label: t('自动禁用') },
            ]}
          />
          {accountStats && (
            <Text className='account-pool-statistics' type='tertiary'>
              {t('已启用')} {accountStats.enabled} · {t('手动禁用')}{' '}
              {accountStats.manual} · {t('自动禁用')} {accountStats.automatic}
            </Text>
          )}
          {observedAt && (
            <Text className='account-observed-at' type='tertiary'>
              {t('状态读取时间')} {observedAt.toLocaleTimeString()}
            </Text>
          )}
        </Space>
        {accountError && (
          <Banner
            className='account-read-error'
            type='danger'
            closeIcon={null}
            description={t(accountError)}
          />
        )}
        {usageRefreshError && (
          <Banner
            className='account-usage-refresh-error'
            type='danger'
            closeIcon={null}
            description={usageRefreshError}
          />
        )}
        <Spin spinning={accountLoading}>
          <Table
            columns={accountColumns}
            dataSource={accounts}
            pagination={
              accountTotal > accountPageSize
                ? {
                    currentPage: accountPage,
                    pageSize: accountPageSize,
                    total: accountTotal,
                    showSizeChanger: false,
                    onPageChange: (page) =>
                      loadAccounts(selectedChannelId, page),
                  }
                : false
            }
            size='small'
            bordered={false}
            rowKey='index'
            scroll={{
              x:
                selectedChannel?.type === DROID_CHANNEL_TYPE
                  ? 1110
                  : 'max-content',
            }}
            empty={emptyNode(
              accountError
                ? t('读取账号失败')
                : accountStatus !== null || accountEmail
                  ? t('没有符合筛选条件的账号')
                  : t('暂无账号'),
              selectedChannel?.type === VERTEX_CHANNEL_TYPE
                ? selectedVertexKeyType === 'api_key'
                  ? t('点击「添加 Vertex AI 账号」批量导入 API Key')
                  : t('点击「添加 Vertex AI 账号」批量导入服务账号 JSON')
                : selectedChannel?.type === DROID_CHANNEL_TYPE
                  ? t('请输入 Factory API Key，每行一条')
                  : t('点击「添加账号」粘贴 OAuth JSON 接入'),
            )}
          />
        </Spin>
      </Card>

      {/* 会话历史 */}
      <Card
        className='!rounded-xl'
        title={<Text strong>{t('会话 → 账号 历史')}</Text>}
        headerExtraContent={
          <Button onClick={() => loadSessions()} loading={sessionLoading}>
            {t('刷新')}
          </Button>
        }
      >
        <Banner
          className='account-session-history-scope'
          type='info'
          closeIcon={null}
          description={t(
            '已读取 {{count}} / {{total}} 条消费日志；以下按用户、令牌及会话 ID 聚合。历史账号序号不代表当前绑定，删除或重排账号后请勿用当前列表反推归属。',
            { count: sessionLogCount, total: sessionLogTotal },
          )}
        />
        {sessionError && (
          <Banner
            className='account-session-read-error'
            type='danger'
            closeIcon={null}
            description={t(sessionError)}
          />
        )}
        <Spin spinning={sessionLoading}>
          <Table
            columns={sessionColumns}
            dataSource={sessions}
            pagination={{ pageSize: 20 }}
            size='small'
            bordered={false}
            rowKey='key'
            scroll={{ x: 'max-content' }}
            empty={emptyNode(
              t('暂无会话记录'),
              t('该渠道最近的消费日志中尚无会话数据'),
            )}
          />
        </Spin>
        {hasMoreSessions && (
          <Button
            className='account-session-load-more'
            theme='borderless'
            loading={sessionLoading}
            onClick={() => loadSessions(selectedChannelId, true)}
          >
            {t('加载更多历史')}
          </Button>
        )}
      </Card>

      {apiKeyImportVisible && (
        <ApiKeyImportModal
          className='account-api-key-import'
          channel={selectedChannel}
          onCancel={() => setApiKeyImportVisible(false)}
          onSuccess={async () => {
            setApiKeyImportVisible(false);
            await loadChannels();
            await refreshAccountLifecycle(selectedChannelId);
          }}
        />
      )}

      {/* 添加账号弹窗 */}
      <Modal
        title={t('添加账号')}
        visible={addVisible}
        onCancel={() => setAddVisible(false)}
        onOk={handleAddAccount}
        confirmLoading={addLoading}
        okText={t('添加')}
        cancelText={t('取消')}
      >
        <Banner
          type='info'
          closeIcon={null}
          className='mb-3'
          description={t(
            '粘贴一个完整的 Claude 订阅 OAuth JSON（包含 access_token / refresh_token / email 等），将以追加方式加入当前渠道。',
          )}
        />
        <Form>
          <Form.TextArea
            field='oauth'
            noLabel
            autosize={{ minRows: 8, maxRows: 16 }}
            placeholder={
              '{\n  "access_token": "...",\n  "refresh_token": "...",\n  "email": "you@example.com",\n  "account_id": "..."\n}'
            }
            value={addJson}
            onChange={(v) => setAddJson(v)}
          />
        </Form>
      </Modal>

      {/* OAuth 授权新账号弹窗 */}
      <Modal
        title={t('授权新账号')}
        visible={oauthVisible}
        onCancel={() => setOauthVisible(false)}
        maskClosable={false}
        width={720}
        footer={
          <Space>
            <Button
              theme='borderless'
              onClick={() => setOauthVisible(false)}
              disabled={oauthLoading}
            >
              {t('取消')}
            </Button>
            <Button
              theme='solid'
              type='primary'
              onClick={completeOAuth}
              loading={oauthLoading}
            >
              {t('完成并加入渠道')}
            </Button>
          </Space>
        }
      >
        <Space vertical spacing='loose' style={{ width: '100%' }}>
          <Banner
            type='info'
            closeIcon={null}
            description={t(
              '走全新 OAuth 授权拿独立 token，不读取本地 Claude 凭证、不会与你当前会话互踢。①填备注 ②点「打开授权页面」登录要接入的订阅账号 ③授权后复制授权码粘到下方 ④点「完成并加入渠道」。',
            )}
          />

          <div style={{ width: '100%' }}>
            <Text type='tertiary' size='small'>
              {t(
                '账号备注（写入该账号的 email 字段，便于在列表/会话历史里识别）',
              )}
            </Text>
            <Input
              value={oauthLabel}
              onChange={setOauthLabel}
              placeholder={t('例如：新Max主号 或 you@example.com')}
              showClear
            />
          </div>

          <Space wrap>
            <Button type='primary' onClick={startOAuth} loading={oauthLoading}>
              {t('打开授权页面')}
            </Button>
            <Button
              theme='outline'
              disabled={!oauthUrl || oauthLoading}
              onClick={() => copy(oauthUrl)}
            >
              {t('复制授权链接')}
            </Button>
          </Space>

          <div style={{ width: '100%' }}>
            <Text type='tertiary' size='small'>
              {t('授权码（或包含 code 与 state 的完整回调 URL）')}
            </Text>
            <Input
              value={oauthCode}
              onChange={setOauthCode}
              placeholder={t('在授权页复制后粘贴到这里')}
              showClear
            />
          </div>
        </Space>
      </Modal>

      <CodexOAuthModal
        visible={codexImportVisible}
        channelId={
          selectedChannel?.type === CODEX_CHANNEL_TYPE
            ? selectedChannelId
            : null
        }
        onCancel={() => setCodexImportVisible(false)}
        onSuccess={async () => {
          setCodexImportVisible(false);
          await loadChannels();
          await refreshAccountLifecycle(selectedChannelId);
        }}
      />

      <GeminiOAuthModal
        visible={geminiImportVisible}
        channelId={selectedChannelId}
        onCancel={() => setGeminiImportVisible(false)}
        onSuccess={handleGeminiModalSuccess}
      />

      <VertexAccountModal
        visible={vertexImportVisible}
        channelId={
          selectedChannel?.type === VERTEX_CHANNEL_TYPE
            ? selectedChannelId
            : null
        }
        keyType={selectedVertexKeyType}
        onCancel={() => setVertexImportVisible(false)}
        onSuccess={async () => {
          setVertexImportVisible(false);
          await loadChannels();
          await loadAccounts(selectedChannelId, 1);
        }}
      />

      <Modal
        className='account-chat-test-modal'
        title={t('单账号 Chat 测试')}
        visible={chatTestAccount !== null}
        onCancel={() => setChatTestAccount(null)}
        maskClosable={!chatTestLoading}
        width={720}
        footer={
          <Space className='account-chat-test-footer'>
            <Button
              className='account-chat-test-cancel'
              theme='borderless'
              disabled={chatTestLoading}
              onClick={() => setChatTestAccount(null)}
            >
              {t('关闭')}
            </Button>
            <Button
              className='account-chat-test-submit'
              theme='solid'
              type='primary'
              loading={chatTestLoading}
              onClick={runChatTest}
            >
              {t('发送测试消息')}
            </Button>
          </Space>
        }
      >
        <Space
          className='account-chat-test-content'
          vertical
          spacing='loose'
          style={{ width: '100%' }}
        >
          <Banner
            className='account-chat-test-account'
            type='info'
            closeIcon={null}
            description={t(
              '本次请求只使用账号 {{account}}，失败时不会切换到渠道内其他账号。',
              {
                account:
                  chatTestAccount?.email ||
                  chatTestAccount?.account_id ||
                  `#${Number(chatTestAccount?.index || 0) + 1}`,
              },
            )}
          />
          {chatTestError && (
            <Banner
              className='account-chat-test-error'
              type='danger'
              closeIcon={null}
              description={chatTestError}
            />
          )}
          <div className='account-chat-test-prompt'>
            <Text
              className='account-chat-test-prompt-label'
              type='tertiary'
              size='small'
            >
              {t('测试消息')}
            </Text>
            <TextArea
              className='account-chat-test-prompt-input'
              value={chatTestPrompt}
              onChange={setChatTestPrompt}
              autosize={{ minRows: 3, maxRows: 8 }}
              maxCount={4000}
              showClear
            />
          </div>
          {chatTestResult && (
            <div className='account-chat-test-result'>
              <Space className='account-chat-test-result-header' spacing={8}>
                <Tag
                  className='account-chat-test-result-status'
                  color='green'
                  shape='circle'
                >
                  {t('可用')}
                </Tag>
                <Text
                  className='account-chat-test-result-time'
                  type='tertiary'
                  size='small'
                >
                  {t('耗时')} {Number(chatTestResult.time || 0).toFixed(2)}s
                </Text>
              </Space>
              <pre
                className='account-chat-test-response'
                style={{
                  margin: '12px 0 0',
                  padding: 12,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: 'var(--semi-color-fill-0)',
                }}
              >
                <code className='account-chat-test-response-code'>
                  {chatTestResult.response}
                </code>
              </pre>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default AccountSessionsPage;
