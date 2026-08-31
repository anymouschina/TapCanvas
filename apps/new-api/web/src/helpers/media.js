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

// 日志媒体预览：从任意请求/响应文本或对象中提取可预览的图片/视频 URL。
// 用于普通日志「请求链路」与任务日志详情，把散落在 JSON body 里的图片/视频链接渲染成缩略图。

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|svg)(?:[?#][^"'\\\s]*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv)(?:[?#][^"'\\\s]*)?$/i;

// 单独抓 http(s) 链接（不含引号/空白/反斜杠等 JSON 分隔符）
const HTTP_URL_RE = /https?:\/\/[^\s"'\\<>)]+/gi;
// data: 内联资源（base64 图片/视频常见于图生图、图编辑入参）
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const DATA_VIDEO_RE = /data:video\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

// 单条 body 最多提取的媒体数量，避免超大响应卡死渲染
const MAX_PER_KIND = 24;

const stripTrailingPunct = (url) => url.replace(/[),.;]+$/, '');

const classifyHttpUrl = (url) => {
  if (IMAGE_EXT_RE.test(url)) return 'image';
  if (VIDEO_EXT_RE.test(url)) return 'video';
  return '';
};

/**
 * 从字符串或对象中提取可预览媒体。
 * @param {string|object|null|undefined} input 原始 body（字符串或已解析对象）
 * @returns {{ images: string[], videos: string[] }}
 */
export function extractMediaUrls(input) {
  const images = [];
  const videos = [];
  const seen = new Set();

  if (input == null) {
    return { images, videos };
  }

  let text;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch (e) {
      return { images, videos };
    }
  }
  if (!text) {
    return { images, videos };
  }

  const push = (kind, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    if (kind === 'image' && images.length < MAX_PER_KIND) images.push(url);
    else if (kind === 'video' && videos.length < MAX_PER_KIND) videos.push(url);
  };

  // 1) data: 内联资源（优先，避免被 http 正则截断）
  (text.match(DATA_IMAGE_RE) || []).forEach((u) => push('image', u));
  (text.match(DATA_VIDEO_RE) || []).forEach((u) => push('video', u));

  // 2) http(s) 链接，按扩展名分类（无法识别的链接忽略）
  (text.match(HTTP_URL_RE) || []).forEach((raw) => {
    const url = stripTrailingPunct(raw);
    const kind = classifyHttpUrl(url);
    if (kind) push(kind, url);
  });

  return { images, videos };
}

/** 是否存在任何可预览媒体 */
export function hasPreviewableMedia(media) {
  return Boolean(media && (media.images?.length || media.videos?.length));
}
