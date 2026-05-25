import React from 'react';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

const DocsPage = () => {
  const isDark =
    document.documentElement.classList.contains('semi-always-dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return (
    <div style={{ height: '100vh', overflow: 'auto' }}>
      <ApiReferenceReact
        configuration={{
          darkMode: isDark,
          sources: [
            { url: '/openapi/relay.json', title: 'AI 中继接口', default: true },
            { url: '/openapi/api.json', title: '后台管理接口' },
          ],
        }}
      />
    </div>
  );
};

export default DocsPage;
