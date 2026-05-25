import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { Route } from 'lucide-react';

const RequestTraceEntry = ({ t, onOpen }) => {
  return (
    <Button
      icon={<Route size={14} />}
      theme='borderless'
      type='tertiary'
      size='small'
      onClick={onOpen}
    >
      {t('查看链路')}
    </Button>
  );
};

export default RequestTraceEntry;
