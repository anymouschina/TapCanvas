import React, { useState } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconAlertTriangle } from '@douyinfe/semi-icons';
import BatchAdjustQuotaModal from './modals/BatchAdjustQuotaModal';

const UsersActions = ({ setShowAddUser, userCount, refresh, t }) => {
  const [showBatchModal, setShowBatchModal] = useState(false);

  return (
    <>
      <div className='flex gap-2 w-full md:w-auto order-2 md:order-1'>
        <Button
          className='w-full md:w-auto'
          onClick={() => setShowAddUser(true)}
          size='small'
        >
          {t('添加用户')}
        </Button>
        <Button
          className='w-full md:w-auto'
          size='small'
          type='warning'
          icon={<IconAlertTriangle />}
          onClick={() => setShowBatchModal(true)}
        >
          {t('调整额度全体用户')}
        </Button>
      </div>

      <BatchAdjustQuotaModal
        visible={showBatchModal}
        onCancel={() => setShowBatchModal(false)}
        userCount={userCount}
        refresh={refresh}
      />
    </>
  );
};

export default UsersActions;
