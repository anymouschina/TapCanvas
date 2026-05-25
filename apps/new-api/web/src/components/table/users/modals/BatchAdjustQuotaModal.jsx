import React, { useState } from 'react';
import {
  Button,
  InputNumber,
  Modal,
  Radio,
  RadioGroup,
  Space,
  Typography,
} from '@douyinfe/semi-ui';
import { IconAlertTriangle } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../../helpers';
import { getCurrencyConfig } from '../../../../helpers/render';
import { displayAmountToQuota } from '../../../../helpers/quota';

const { Text } = Typography;

const BatchAdjustQuotaModal = ({ visible, onCancel, userCount, refresh }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { symbol } = getCurrencyConfig();

  const handleConfirm = async () => {
    if (!amount || amount <= 0) {
      showError(t('请输入大于 0 的金额'));
      return;
    }
    setLoading(true);
    try {
      const quotaValue = displayAmountToQuota(amount);
      const res = await API.post('/api/user/batch_quota', {
        mode,
        value: quotaValue,
      });
      if (res?.data?.success) {
        const count = res.data.affected ?? 0;
        showSuccess(t('已对N个用户执行批量调整', { count }));
        setAmount(0);
        setMode('add');
        onCancel();
        refresh?.();
      } else {
        showError(res?.data?.message || t('操作失败，请重试'));
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  };

  return (
    <Modal
      title={
        <Space>
          <IconAlertTriangle style={{ color: 'var(--semi-color-warning)' }} />
          {t('调整额度全体用户')}
        </Space>
      }
      visible={visible}
      onCancel={onCancel}
      footer={
        <div className='flex justify-end gap-2'>
          <Button onClick={onCancel}>{t('取消')}</Button>
          <Button
            theme='solid'
            type='danger'
            loading={loading}
            onClick={handleConfirm}
          >
            {t('确认执行')}
          </Button>
        </div>
      }
      centered
    >
      <Space vertical align='start' className='w-full' style={{ gap: 16 }}>
        <div>
          <Text type='tertiary' size='small'>
            {t('当前启用用户数')}：{userCount ?? '—'}
          </Text>
        </div>

        <RadioGroup
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          type='button'
        >
          <Radio value='add'>{t('增加')}</Radio>
          <Radio value='subtract'>{t('减少')}</Radio>
        </RadioGroup>

        <InputNumber
          value={amount}
          onChange={(v) => setAmount(Number(v) || 0)}
          min={0.01}
          precision={2}
          prefix={symbol}
          style={{ width: 200 }}
          placeholder='0.00'
        />

        {mode === 'subtract' && (
          <Text type='danger' size='small'>
            {t('减少时余额不足将被清零不可撤销')}
          </Text>
        )}
      </Space>
    </Modal>
  );
};

export default BatchAdjustQuotaModal;
