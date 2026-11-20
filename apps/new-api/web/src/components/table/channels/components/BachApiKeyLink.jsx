import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  BACH_CHANNEL_TYPE,
  BACH_PROVIDER_URL,
} from '../../../../constants';

export function isBachChannel(channelType, baseUrl) {
  if (channelType === BACH_CHANNEL_TYPE) {
    return true;
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    return false;
  }
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'bach.art' || host.endsWith('.bach.art'))
    );
  } catch {
    return false;
  }
}

export default function BachApiKeyLink({ channelType, baseUrl, className = '' }) {
  const { t } = useTranslation();
  if (!isBachChannel(channelType, baseUrl)) {
    return null;
  }

  return (
    <a
      className={`bach-channel-apply-key-link ${className}`.trim()}
      href={BACH_PROVIDER_URL}
      target='_blank'
      rel='noopener noreferrer'
      style={{ color: 'var(--semi-color-link)' }}
    >
      {t('申请 API Key')}
    </a>
  );
}
