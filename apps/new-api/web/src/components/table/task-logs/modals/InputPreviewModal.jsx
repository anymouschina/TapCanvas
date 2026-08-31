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
import { Modal, Typography, Image, ImagePreview, Empty } from '@douyinfe/semi-ui';
import { IconCopy } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

// 入参预览弹窗：集中展示一条任务的参考图 + 提示词等入参信息
const InputPreviewModal = ({ isModalOpen, setIsModalOpen, inputData }) => {
  const { t } = useTranslation();
  const props = inputData || {};

  // 参考图列表：兼容 reference_urls 数组与单个 input_video_url（视频参考另行展示）
  const allRefs = Array.isArray(props.reference_urls)
    ? props.reference_urls.filter((u) => typeof u === 'string' && u.trim())
    : [];
  const referenceUrls = allRefs.filter((u) => /^https?:\/\//.test(u));
  // asset:// 等非 http 引用浏览器无法直接渲染（http 在送审时被转成 ARK 资产引用）。
  // 不能默默吞掉——否则用户点「查看参考图(N)」却空白。列出来并说明在哪看解析后的图。
  const opaqueRefs = allRefs.filter((u) => !/^https?:\/\//.test(u));
  const inputVideoUrl =
    typeof props.input_video_url === 'string' &&
    /^https?:\/\//.test(props.input_video_url)
      ? props.input_video_url
      : '';
  const prompt = props.input || '';
  const negativePrompt = props.negative_prompt || '';

  const renderField = (label, value) => {
    if (!value) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>
          {label}
        </Text>
        <Text
          copyable={{ content: value, icon: <IconCopy /> }}
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {value}
        </Text>
      </div>
    );
  };

  const hasAnything =
    referenceUrls.length > 0 ||
    opaqueRefs.length > 0 ||
    inputVideoUrl ||
    prompt ||
    negativePrompt;

  return (
    <Modal
      title={t('入参预览')}
      visible={isModalOpen}
      onOk={() => setIsModalOpen(false)}
      onCancel={() => setIsModalOpen(false)}
      footer={null}
      closable
      width={720}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto', padding: '24px' }}
    >
      {!hasAnything ? (
        <Empty
          description={t('该任务暂无可预览的入参信息')}
          style={{ padding: 30 }}
        />
      ) : (
        <>
          {referenceUrls.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title heading={6} style={{ marginBottom: 8 }}>
                {t('参考图')}
                <Text type='tertiary' style={{ marginLeft: 8, fontWeight: 400 }}>
                  ×{referenceUrls.length}
                </Text>
              </Title>
              <ImagePreview>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  {referenceUrls.map((url, i) => (
                    <Image
                      key={i}
                      src={url}
                      width={120}
                      height={120}
                      imgStyle={{
                        width: 120,
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 8,
                        display: 'block',
                      }}
                      style={{
                        width: 120,
                        height: 120,
                        borderRadius: 8,
                        border: '1px solid var(--semi-color-border)',
                        overflow: 'hidden',
                      }}
                    />
                  ))}
                </div>
              </ImagePreview>
            </div>
          )}

          {opaqueRefs.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title heading={6} style={{ marginBottom: 8 }}>
                {t('参考图引用')}
                <Text type='tertiary' style={{ marginLeft: 8, fontWeight: 400 }}>
                  ×{opaqueRefs.length}
                </Text>
              </Title>
              <Text
                type='tertiary'
                size='small'
                style={{ display: 'block', marginBottom: 8 }}
              >
                {t(
                  '这些参考图以 asset:// 资产引用形式送审（原图在送审时被转为 ARK 资产），无法在此直接预览；解析后的图片可在画布对应节点或「请求链路」中查看。',
                )}
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {opaqueRefs.map((ref, i) => (
                  <Text
                    key={i}
                    copyable={{ content: ref, icon: <IconCopy /> }}
                    code
                    style={{ fontSize: 12, wordBreak: 'break-all' }}
                  >
                    {ref}
                  </Text>
                ))}
              </div>
            </div>
          )}

          {inputVideoUrl && (
            <div style={{ marginBottom: 16 }}>
              <Title heading={6} style={{ marginBottom: 8 }}>
                {t('参考视频')}
              </Title>
              <video
                src={inputVideoUrl}
                controls
                style={{
                  width: '100%',
                  maxHeight: '40vh',
                  borderRadius: 8,
                  border: '1px solid var(--semi-color-border)',
                }}
              />
            </div>
          )}

          {renderField(t('提示词'), prompt)}
          {renderField(t('反向提示词'), negativePrompt)}
        </>
      )}
    </Modal>
  );
};

export default InputPreviewModal;
