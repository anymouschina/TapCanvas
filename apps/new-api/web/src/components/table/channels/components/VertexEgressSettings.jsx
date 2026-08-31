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

import React from 'react';
import { Banner, Form } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const VertexEgressSettings = ({ inputs, onSettingChange }) => {
  const { t } = useTranslation();
  const enabled = inputs.vertex_egress_isolation_enabled === true;

  return (
    <div className='mb-3'>
      <Form.Switch
        field='vertex_egress_isolation_enabled'
        label={t('Vertex Dedicated Egress 隔离')}
        checkedText={t('隔离')}
        uncheckedText={t('直连')}
        onChange={(value) =>
          onSettingChange('vertex_egress_isolation_enabled', value)
        }
        extraText={t(
          '关闭时强制直连 Google 官方 Vertex AI；开启时每个账号稳定绑定一个专属出口，Token 与模型请求使用同一出口。出口异常时明确失败，不会回退直连。',
        )}
      />
      {enabled && (
        <>
          <Banner
            type='warning'
            closeIcon={null}
            className='mb-3 rounded-xl'
            description={t(
              '这里只接入已经由 Cloudflare Dedicated Egress 策略或自有网关提供的代理端点。普通 Worker 域名不是独享静态出口。',
            )}
          />
          <Form.TextArea
            field='vertex_egress_cells_text'
            label={t('Dedicated Egress 出口池')}
            placeholder={t(
              '每行一个：出口ID|代理地址\n例如：tokyo-01|https://user:pass@proxy.example.com:443',
            )}
            autosize={{ minRows: 4, maxRows: 12 }}
            showClear
            onChange={(value) =>
              onSettingChange('vertex_egress_cells_text', value)
            }
            rules={[
              {
                required: true,
                message: t('开启隔离时必须配置至少一个 Dedicated Egress 出口'),
              },
            ]}
            extraText={t(
              '出口 ID 必须唯一且保持稳定；支持 http、https、socks5、socks5h。修改代理凭证不会改变账号分片，删除出口会让绑定该出口的异步任务显式停止轮询。',
            )}
          />
        </>
      )}
    </div>
  );
};

export default VertexEgressSettings;
