import React, { useEffect, useRef, useState } from 'react';
import { Modal, Typography, Spin, Tag } from '@douyinfe/semi-ui';
import { QRCodeSVG } from 'qrcode.react';
import { SiWechat } from 'react-icons/si';
import { API, showError, showSuccess } from '../../../helpers';

const POLL_INTERVAL_MS = 2000;

const WxPayQRModal = ({ visible, codeUrl, tradeNo, onSuccess, onClose, t }) => {
  const [status, setStatus] = useState('pending');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible || !tradeNo) return;
    setStatus('pending');

    const poll = async () => {
      try {
        const res = await API.get(`/api/user/wxpay/order/${tradeNo}`);
        const { message, status: payStatus } = res.data;
        if (message === 'success' && payStatus === 'success') {
          setStatus('success');
          showSuccess(t('支付成功！'));
          clearInterval(timerRef.current);
          setTimeout(() => onSuccess(), 800);
          return;
        }
      } catch (_) {
        // silent — keep polling
      }
    };

    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [visible, tradeNo]);

  const handleClose = () => {
    clearInterval(timerRef.current);
    onClose();
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-2'>
          <SiWechat size={20} color='#07C160' />
          <span>{t('微信扫码支付')}</span>
        </div>
      }
      visible={visible}
      onCancel={handleClose}
      footer={null}
      centered
      width={320}
    >
      <div className='flex flex-col items-center gap-4 py-2'>
        {status === 'success' ? (
          <div className='text-center'>
            <Tag color='green' size='large'>{t('支付成功')}</Tag>
          </div>
        ) : codeUrl ? (
          <>
            <div className='p-3 border border-gray-200 rounded-xl shadow-sm bg-white'>
              <QRCodeSVG value={codeUrl} size={220} />
            </div>
            <div className='flex items-center gap-2'>
              <Spin size='small' />
              <Typography.Text type='secondary' className='text-sm'>
                {t('请使用微信扫码支付，等待确认中…')}
              </Typography.Text>
            </div>
          </>
        ) : (
          <Spin size='large' />
        )}
      </div>
    </Modal>
  );
};

export default WxPayQRModal;
