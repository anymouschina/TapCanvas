import React, { useEffect, useState } from 'react';
import { Button, Card, InputNumber, Space, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';
import { getCurrencyConfig } from '../../../helpers/render';
import {
  displayAmountToQuota,
  quotaToDisplayAmount,
} from '../../../helpers/quota';

const { Text } = Typography;

const NewUserBonusCard = () => {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const { symbol } = getCurrencyConfig();

  useEffect(() => {
    API.get('/api/option/').then((res) => {
      if (!res?.data?.success) return;
      const item = res.data.data.find((o) => o.key === 'QuotaForNewUser');
      if (item) {
        setAmount(
          Number(quotaToDisplayAmount(parseInt(item.value) || 0).toFixed(6)),
        );
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await API.put('/api/option/', {
        key: 'QuotaForNewUser',
        value: String(displayAmountToQuota(amount)),
      });
      if (res?.data?.success) {
        showSuccess(t('新用户注册赠送金额') + t('保存成功'));
      } else {
        showError(res?.data?.message || t('保存失败，请重试'));
      }
    } catch (e) {
      showError(e.message);
    }
    setSaving(false);
  };

  return (
    <Card className='mb-3' bodyStyle={{ padding: '12px 16px' }}>
      <Space align='center'>
        <Text strong>{t('新用户注册赠送金额')}</Text>
        <InputNumber
          value={amount}
          onChange={(v) => setAmount(Number(v) || 0)}
          min={0}
          precision={2}
          prefix={symbol}
          style={{ width: 140 }}
        />
        <Button size='small' onClick={handleSave} loading={saving}>
          {t('保存')}
        </Button>
      </Space>
    </Card>
  );
};

export default NewUserBonusCard;
