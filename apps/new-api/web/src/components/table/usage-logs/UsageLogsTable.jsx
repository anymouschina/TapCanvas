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

import React, { useMemo } from 'react';
import { Empty, Descriptions, Tag, Space, Toast } from '@douyinfe/semi-ui';
import { IconCopy } from '@douyinfe/semi-icons';
import CardTable from '../../common/ui/CardTable';
import { renderQuota } from '../../../helpers';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import { getLogsColumns } from './UsageLogsColumnDefs';

const LogsTable = (logsData) => {
  const {
    logs,
    groupedLogs,
    expandData,
    loading,
    activePage,
    pageSize,
    logCount,
    compactMode,
    visibleColumns,
    handlePageChange,
    handlePageSizeChange,
    copyText,
    showUserInfoFunc,
    openChannelAffinityUsageCacheModal,
    hasExpandableRows,
    isAdminUser,
    billingDisplayMode,
    t,
    COLUMN_KEYS,
    conversationGroups,
    expandedConvIds,
    toggleConversationExpand,
  } = logsData;

  const displayLogs = groupedLogs && groupedLogs.length > 0 ? groupedLogs : logs;

  // Get all columns
  const allColumns = useMemo(() => {
    return getLogsColumns({
      t,
      COLUMN_KEYS,
      copyText,
      showUserInfoFunc,
      openChannelAffinityUsageCacheModal,
      isAdminUser,
      billingDisplayMode,
    });
  }, [
    t,
    COLUMN_KEYS,
    copyText,
    showUserInfoFunc,
    openChannelAffinityUsageCacheModal,
    isAdminUser,
    billingDisplayMode,
  ]);

  // Filter columns based on visibility settings
  const getVisibleColumns = () => {
    return allColumns.filter((column) => visibleColumns[column.key]);
  };

  const visibleColumnsList = useMemo(() => {
    return getVisibleColumns();
  }, [visibleColumns, allColumns]);

  const tableColumns = useMemo(() => {
    return compactMode
      ? visibleColumnsList.map(({ fixed, ...rest }) => rest)
      : visibleColumnsList;
  }, [compactMode, visibleColumnsList]);

  const expandRowRender = (record, index) => {
    const siblings = record._siblings || [];
    const convId = record.conversation_id;

    // 当前页已有同会话兄弟记录，直接内联显示
    const showInlineSiblings = siblings.length > 0;

    // 没有当前页兄弟，但有 conversation_id，保留跨页懒加载
    const showCrossPageToggle = convId && !showInlineSiblings;
    const convExpanded = showCrossPageToggle && expandedConvIds && expandedConvIds.has(convId);
    const convGroup = showCrossPageToggle && conversationGroups ? conversationGroups[convId] : null;

    return (
      <div>
        <Descriptions data={expandData[record.key]} />
        {convId && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            <span>会话 ID:</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--semi-color-text-1)' }}>
              {convId.length > 24 ? `${convId.slice(0, 12)}…${convId.slice(-8)}` : convId}
            </span>
            <IconCopy
              size='small'
              style={{ cursor: 'pointer', color: 'var(--semi-color-primary)' }}
              onClick={(e) => {
                e.stopPropagation();
                copyText(e, convId).then(() => Toast.success('已复制会话 ID'));
              }}
            />
          </div>
        )}
        {showInlineSiblings && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--semi-color-border)', paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>
              同会话其他 {siblings.length} 次调用：
            </div>
            <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 4, padding: '4px 8px' }}>
              {siblings.map(sib => (
                <div
                  key={sib.id || sib.request_id}
                  style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--semi-color-border)', color: 'var(--semi-color-text-1)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <span style={{ color: 'var(--semi-color-text-0)', fontWeight: 500 }}>{sib.model_name}</span>
                  <span style={{ color: 'var(--semi-color-text-2)' }}>{sib.timestamp2string}</span>
                  <span>输入 {sib.prompt_tokens} · 输出 {sib.completion_tokens}</span>
                  {sib.quota > 0 && <span style={{ color: 'var(--semi-color-success)' }}>{renderQuota(sib.quota, 6)}</span>}
                  {sib.use_time > 0 && <Tag color='green' shape='circle' size='small'>{sib.use_time}s</Tag>}
                  {sib.request_id && (
                    <span style={{ color: 'var(--semi-color-text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                      {sib.request_id.slice(0, 16)}…
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {showCrossPageToggle && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--semi-color-border)', paddingTop: 8 }}>
            <button
              style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--semi-color-primary)', fontSize: 13, padding: 0 }}
              onClick={(e) => { e.stopPropagation(); toggleConversationExpand && toggleConversationExpand(convId); }}
            >
              {convExpanded ? '▲' : '▼'} 同会话其他调用
              {convGroup?.logs?.length > 0 && ` (${convGroup.logs.length})`}
            </button>
            {convExpanded && convGroup?.loading && (
              <span style={{ marginLeft: 8, color: 'var(--semi-color-text-2)', fontSize: 12 }}>加载中...</span>
            )}
            {convExpanded && !convGroup?.loading && convGroup?.logs?.length > 0 && (
              <div style={{ marginTop: 8, background: 'var(--semi-color-fill-0)', borderRadius: 4, padding: '4px 8px' }}>
                {convGroup.logs.map(log => (
                  <div
                    key={log.id || log.request_id}
                    style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--semi-color-border)', color: 'var(--semi-color-text-1)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                  >
                    <span style={{ color: 'var(--semi-color-text-0)', fontWeight: 500 }}>{log.model_name}</span>
                    <span style={{ color: 'var(--semi-color-text-2)' }}>{new Date(log.created_at * 1000).toLocaleString()}</span>
                    <span>输入 {log.prompt_tokens} · 输出 {log.completion_tokens}</span>
                    {log.quota > 0 && <span style={{ color: 'var(--semi-color-success)' }}>{renderQuota(log.quota, 6)}</span>}
                    {log.use_time > 0 && <Tag color='green' shape='circle' size='small'>{log.use_time}s</Tag>}
                    {log.request_id && (
                      <span style={{ color: 'var(--semi-color-text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                        {log.request_id.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {convExpanded && !convGroup?.loading && (!convGroup?.logs || convGroup.logs.length === 0) && (
              <span style={{ marginLeft: 8, color: 'var(--semi-color-text-2)', fontSize: 12 }}>无其他调用</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <CardTable
      columns={tableColumns}
      {...(hasExpandableRows() && {
        expandedRowRender: expandRowRender,
        expandRowByClick: true,
        rowExpandable: (record) =>
          (expandData[record.key] && expandData[record.key].length > 0) ||
          (record._siblings && record._siblings.length > 0),
      })}
      dataSource={displayLogs}
      rowKey='key'
      loading={loading}
      scroll={compactMode ? undefined : { x: 'max-content' }}
      className='rounded-xl overflow-hidden'
      size='small'
      empty={
        <Empty
          image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
          }
          description={t('搜索无结果')}
          style={{ padding: 30 }}
        />
      }
      pagination={{
        currentPage: activePage,
        pageSize: pageSize,
        total: logCount,
        pageSizeOptions: [10, 20, 50, 100],
        showSizeChanger: true,
        onPageSizeChange: (size) => {
          handlePageSizeChange(size);
        },
        onPageChange: handlePageChange,
      }}
      hidePagination={true}
    />
  );
};

export default LogsTable;
