import React from 'react';
import { useTranslation } from 'react-i18next';

const HEYROUTE_REFERRAL_URL = 'https://heyroute.ai/r/c/ch_iiq2tvtmrc';

export default function HeyRouteApiKeyLink({ baseUrl, className }) {
  const { t } = useTranslation();
  let isHeyRoute = false;
  try {
    const url = new URL(baseUrl);
    isHeyRoute = url.protocol === 'https:' && url.hostname === 'heyroute.ai';
  } catch {
    // Incomplete channel URLs do not identify a provider.
    return null;
  }
  if (!isHeyRoute) return null;

  return (
    <a
      className={`heyroute-channel-apply-key-link ${className}`}
      href={HEYROUTE_REFERRAL_URL}
      target='_blank'
      rel='noopener noreferrer'
      style={{ color: 'var(--semi-color-link)' }}
    >
      {t('申请 API Key')}
    </a>
  );
}
