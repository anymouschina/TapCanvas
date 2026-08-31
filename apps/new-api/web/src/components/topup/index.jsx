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

import React, { useContext, useEffect, useState } from 'react';
import { Button, Card, Input, Modal, Typography } from '@douyinfe/semi-ui';
import { Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../context/User';
import {
  API,
  copy,
  getQuotaPerUnit,
  renderQuota,
  showError,
  showInfo,
  showSuccess,
} from '../../helpers';
import InvitationCard from './InvitationCard';
import TransferModal from './modals/TransferModal';

const TopUp = () => {
  const { t } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);
  const [redemptionCode, setRedemptionCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [affLink, setAffLink] = useState('');
  const [openTransfer, setOpenTransfer] = useState(false);
  const [transferAmount, setTransferAmount] = useState(getQuotaPerUnit());

  const refreshUser = async () => {
    const response = await API.get('/api/user/self');
    const { success, message, data } = response.data;
    if (!success) throw new Error(message || t('获取用户信息失败'));
    userDispatch({ type: 'login', payload: data });
  };

  const redeem = async () => {
    const key = redemptionCode.trim();
    if (!key) {
      showInfo(t('请输入兑换码！'));
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await API.post('/api/user/topup', { key });
      const { success, message, data } = response.data;
      if (!success) {
        showError(message);
        return;
      }
      await refreshUser();
      setRedemptionCode('');
      showSuccess(t('兑换成功！'));
      Modal.success({
        title: t('兑换成功！'),
        content: t('成功兑换额度：') + renderQuota(data),
        centered: true,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : t('请求失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const transfer = async () => {
    if (transferAmount < getQuotaPerUnit()) {
      showError(`${t('划转金额最低为')} ${renderQuota(getQuotaPerUnit())}`);
      return;
    }
    const response = await API.post('/api/user/aff_transfer', { quota: transferAmount });
    const { success, message } = response.data;
    if (!success) {
      showError(message);
      return;
    }
    await refreshUser();
    setOpenTransfer(false);
    showSuccess(message);
  };

  useEffect(() => {
    void refreshUser().catch((error) => showError(error instanceof Error ? error.message : t('请求失败')));
    void API.get('/api/user/aff').then((response) => {
      const { success, message, data } = response.data;
      if (!success) throw new Error(message || t('获取邀请链接失败'));
      setAffLink(`${window.location.origin}/register?aff=${data}`);
    }).catch((error) => showError(error instanceof Error ? error.message : t('获取邀请链接失败')));
  }, []);

  const copyAffLink = async () => {
    await copy(affLink);
    showSuccess(t('邀请链接已复制到剪切板'));
  };

  return (
    <div className='w-full max-w-7xl mx-auto relative min-h-screen lg:min-h-0 mt-[60px] px-2'>
      <TransferModal
        t={t}
        openTransfer={openTransfer}
        transfer={transfer}
        handleTransferCancel={() => setOpenTransfer(false)}
        userState={userState}
        renderQuota={renderQuota}
        getQuotaPerUnit={getQuotaPerUnit}
        transferAmount={transferAmount}
        setTransferAmount={setTransferAmount}
      />
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        <Card className='!rounded-2xl shadow-sm border-0'>
          <div className='flex items-center mb-4'>
            <Gift size={18} className='mr-3' />
            <Typography.Text className='text-lg font-medium'>{t('兑换码')}</Typography.Text>
          </div>
          <div className='flex gap-3'>
            <Input
              value={redemptionCode}
              onChange={setRedemptionCode}
              onEnterPress={() => void redeem()}
              placeholder={t('请输入兑换码')}
              className='!rounded-lg'
            />
            <Button type='primary' theme='solid' loading={isSubmitting} onClick={() => void redeem()}>
              {t('兑换')}
            </Button>
          </div>
        </Card>
        <InvitationCard
          t={t}
          userState={userState}
          renderQuota={renderQuota}
          setOpenTransfer={setOpenTransfer}
          affLink={affLink}
          handleAffLinkClick={() => void copyAffLink()}
        />
      </div>
    </div>
  );
};

export default TopUp;
