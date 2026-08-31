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

import React, { useContext, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import { API } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { UserContext } from '../../context/User';
import { useActualTheme } from '../../context/Theme';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import NoticeModal from '../../components/layout/NoticeModal';
import HomeHero from '../../components/home/HomeHero';
import ModelStatsSection from '../../components/home/ModelStatsSection';
import PublicModelStatsChart from '../../components/model-stats/PublicModelStatsChart';
import './home.css';

const Home = () => {
  const { t, i18n } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const [userState] = useContext(UserContext);
  const actualTheme = useActualTheme();
  const isMobile = useIsMobile();
  const customFrameRef = useRef(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [customContent, setCustomContent] = useState('');
  const [customContentError, setCustomContentError] = useState('');
  const [activeModelCategory, setActiveModelCategory] = useState('all');
  const status = statusState?.status;
  const serverAddress = status?.server_address || window.location.origin;

  useEffect(() => {
    const checkNotice = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      if (lastCloseDate === new Date().toDateString()) return;
      try {
        const response = await API.get('/api/notice');
        const { success, data } = response.data;
        if (success && typeof data === 'string' && data.trim() !== '') {
          setNoticeVisible(true);
        }
      } catch (error) {
        console.error('获取公告失败:', error);
      }
    };

    checkNotice();
  }, []);

  useEffect(() => {
    const loadCustomContent = async () => {
      setCustomContentError('');
      try {
        const response = await API.get('/api/home_page_content');
        const { success, message, data } = response.data;
        if (!success) {
          throw new Error(message || t('自定义首页内容加载失败'));
        }
        if (typeof data !== 'string' || data.trim() === '') {
          setCustomContent('');
          return;
        }
        setCustomContent(
          data.startsWith('https://') ? data : marked.parse(data),
        );
      } catch (error) {
        setCustomContent('');
        setCustomContentError(error?.message || t('自定义首页内容加载失败'));
      }
    };

    loadCustomContent();
  }, [t]);

  useEffect(() => {
    const frame = customFrameRef.current;
    if (!frame || !customContent.startsWith('https://')) return;
    const sendContext = () => {
      frame.contentWindow?.postMessage({ themeMode: actualTheme }, '*');
      frame.contentWindow?.postMessage({ lang: i18n.language }, '*');
    };
    frame.addEventListener('load', sendContext);
    return () => frame.removeEventListener('load', sendContext);
  }, [actualTheme, customContent, i18n.language]);

  return (
    <main className='tc-home'>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />

      <div className='tc-home__shell'>
        <HomeHero
          serverAddress={serverAddress}
          status={status}
          user={userState?.user}
        />
        <ModelStatsSection
          activeCategory={activeModelCategory}
          onCategoryChange={setActiveModelCategory}
        />
        <PublicModelStatsChart
          category={activeModelCategory}
          titleId='tc-home-model-stats-chart-title'
        />

        {customContentError && (
          <div className='tc-home-custom-state' role='alert'>
            <strong className='tc-home-custom-state__title'>
              {t('自定义内容未加载')}
            </strong>
            <span className='tc-home-custom-state__description'>
              {customContentError}
            </span>
          </div>
        )}

        {customContent && (
          <section className='tc-home-custom' aria-label={t('自定义首页内容')}>
            {customContent.startsWith('https://') ? (
              <iframe
                className='tc-home-custom__frame'
                ref={customFrameRef}
                src={customContent}
                title={t('自定义首页内容')}
              />
            ) : (
              <div
                className='tc-home-custom__html'
                dangerouslySetInnerHTML={{ __html: customContent }}
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
};

export default Home;
