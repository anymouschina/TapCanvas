import React from 'react';
import { Button, Empty, Modal, Spin, Typography } from '@douyinfe/semi-ui';
import { IconCopy } from '@douyinfe/semi-icons';
import { copy, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const codeStyle = {
  margin: 0,
  padding: '12px 14px',
  borderRadius: 8,
  background: 'var(--semi-color-fill-0)',
  border: '1px solid var(--semi-color-border)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily:
    'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace',
};

const renderCodeBlock = (content, emptyText) => {
  if (!content) {
    return (
      <div style={{ ...codeStyle, color: 'var(--semi-color-text-2)' }}>
        {emptyText}
      </div>
    );
  }
  return <pre style={codeStyle}>{content}</pre>;
};

const RequestTraceModal = ({
  showRequestTraceModal,
  setShowRequestTraceModal,
  requestTraceData,
  loadingRequestTrace,
  t,
}) => {
  const copyAll = async () => {
    if (!requestTraceData) {
      return;
    }
    const content = JSON.stringify(requestTraceData, null, 2);
    if (await copy(content)) {
      showSuccess(t('请求链路已复制'));
      return;
    }
    showError(t('无法复制到剪贴板，请手动复制'));
  };

  const attempts = Array.isArray(requestTraceData?.attempts)
    ? requestTraceData.attempts
    : [];

  return (
    <Modal
      title={t('请求链路 Payload')}
      visible={showRequestTraceModal}
      onCancel={() => setShowRequestTraceModal(false)}
      footer={null}
      centered
      closable
      maskClosable
      width={960}
    >
      <div style={{ padding: '8px 20px 20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <Text style={{ fontWeight: 600 }}>
                {requestTraceData?.request_id || '-'}
              </Text>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 12,
                color: 'var(--semi-color-text-2)',
              }}
            >
              {requestTraceData?.request_path ? (
                <Text type='tertiary' size='small'>
                  {t('请求路径')}: {requestTraceData.request_path}
                </Text>
              ) : null}
              {requestTraceData?.model_name ? (
                <Text type='tertiary' size='small'>
                  {t('请求模型')}: {requestTraceData.model_name}
                </Text>
              ) : null}
            </div>
          </div>

          <Button
            icon={<IconCopy />}
            theme='borderless'
            type='tertiary'
            size='small'
            onClick={copyAll}
            disabled={!requestTraceData}
          >
            {t('复制')}
          </Button>
        </div>

        <Spin spinning={loadingRequestTrace}>
          {!requestTraceData ? (
            <Empty description={t('暂无请求链路')} style={{ padding: '32px 0' }} />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
                maxHeight: '68vh',
                overflowY: 'auto',
                paddingRight: 2,
              }}
            >
              <section>
                <Text style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                  {t('原始请求 Body')}
                </Text>
                {renderCodeBlock(
                  requestTraceData.original_request_body,
                  t('当前没有记录原始请求体'),
                )}
              </section>

              {attempts.length === 0 ? (
                <Empty
                  description={t('当前没有记录上游链路')}
                  style={{ padding: '12px 0 4px' }}
                />
              ) : (
                attempts.map((attempt) => (
                  <section
                    key={`attempt-${attempt.retry_index}`}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 10,
                      border: '1px solid var(--semi-color-border)',
                      background: 'var(--semi-color-bg-1)',
                    }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      <Text style={{ fontWeight: 600 }}>
                        {t('尝试')} #{attempt.retry_index + 1}
                      </Text>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 6,
                          fontSize: 12,
                          color: 'var(--semi-color-text-2)',
                        }}
                      >
                        {attempt.channel_id ? (
                          <Text type='tertiary' size='small'>
                            {t('渠道')}: {attempt.channel_id}
                          </Text>
                        ) : null}
                        {attempt.request_model ? (
                          <Text type='tertiary' size='small'>
                            {t('请求模型')}: {attempt.request_model}
                          </Text>
                        ) : null}
                        {attempt.upstream_model ? (
                          <Text type='tertiary' size='small'>
                            {t('上游模型')}: {attempt.upstream_model}
                          </Text>
                        ) : null}
                        {attempt.upstream_url ? (
                          <Text type='tertiary' size='small'>
                            {t('上游 URL')}: {attempt.upstream_url}
                          </Text>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <Text
                          style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}
                        >
                          {t('上游请求 Body')}
                        </Text>
                        {renderCodeBlock(
                          attempt.upstream_request_body,
                          t('当前没有记录上游请求体'),
                        )}
                      </div>

                      <div>
                        <Text
                          style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}
                        >
                          {t('上游响应 Body')}
                        </Text>
                        {renderCodeBlock(
                          attempt.upstream_response_body,
                          t('当前没有记录上游响应体'),
                        )}
                      </div>

                      {attempt.error_message ? (
                        <div>
                          <Text
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              marginBottom: 8,
                              color: 'var(--semi-color-danger)',
                            }}
                          >
                            {t('错误')}
                          </Text>
                          {renderCodeBlock(attempt.error_message, '')}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ))
              )}
            </div>
          )}
        </Spin>
      </div>
    </Modal>
  );
};

export default RequestTraceModal;
