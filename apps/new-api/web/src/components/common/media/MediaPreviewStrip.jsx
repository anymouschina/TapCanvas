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
import { Image, ImagePreview, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const thumbBorder = '1px solid var(--semi-color-border)';

// 日志媒体预览条：把从 body 中提取出的图片/视频统一渲染成缩略图。
// 图片点击放大（Semi ImagePreview），视频内联轻量预览（preload=metadata）。
const MediaPreviewStrip = ({ media, title, compact = false }) => {
  const { t } = useTranslation();
  const images = Array.isArray(media?.images) ? media.images : [];
  const videos = Array.isArray(media?.videos) ? media.videos : [];

  if (images.length === 0 && videos.length === 0) {
    return null;
  }

  const imgSize = compact ? 72 : 96;

  return (
    <div style={{ marginBottom: compact ? 0 : 12 }}>
      {title ? (
        <Text
          strong
          style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
        >
          {title}
          <Text type='tertiary' style={{ marginLeft: 8, fontWeight: 400 }}>
            {t('图片')} ×{images.length} · {t('视频')} ×{videos.length}
          </Text>
        </Text>
      ) : null}

      {images.length > 0 && (
        <ImagePreview>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {images.map((url, i) => (
              <Image
                key={`img-${i}`}
                src={url}
                width={imgSize}
                height={imgSize}
                // objectFit 必须落在 imgStyle(内层 <img>),放 style(外层 wrapper)不裁剪 → 尺寸错乱
                imgStyle={{
                  width: imgSize,
                  height: imgSize,
                  objectFit: 'cover',
                  borderRadius: 8,
                  display: 'block',
                }}
                style={{
                  width: imgSize,
                  height: imgSize,
                  borderRadius: 8,
                  border: thumbBorder,
                  overflow: 'hidden',
                  flex: '0 0 auto',
                }}
              />
            ))}
          </div>
        </ImagePreview>
      )}

      {videos.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: images.length > 0 ? 8 : 0,
          }}
        >
          {videos.map((url, i) => (
            <video
              key={`vid-${i}`}
              src={url}
              controls
              preload='metadata'
              style={{
                width: compact ? 160 : 220,
                maxHeight: compact ? 110 : 150,
                borderRadius: 8,
                border: thumbBorder,
                background: '#000',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaPreviewStrip;
