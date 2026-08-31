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

import { useCallback, useEffect, useState } from 'react';
import { API } from '../../helpers';

const validateProtocolCatalog = (catalog) => {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('协议目录必须是非空数组');
  }
  const protocolIDs = new Set();
  catalog.forEach((protocol, protocolIndex) => {
    if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol)) {
      throw new Error(`协议目录第 ${protocolIndex + 1} 项格式无效`);
    }
    if (typeof protocol.id !== 'string' || !protocol.id.trim()) {
      throw new Error(`协议目录第 ${protocolIndex + 1} 项缺少 id`);
    }
    if (protocolIDs.has(protocol.id)) {
      throw new Error(`协议目录包含重复 id: ${protocol.id}`);
    }
    protocolIDs.add(protocol.id);
    if (
      typeof protocol.name !== 'string' ||
      !protocol.name.trim() ||
      !['relay', 'task', 'native'].includes(protocol.transport)
    ) {
      throw new Error(`协议 ${protocol.id} 的名称或 transport 无效`);
    }
    if (
      !Array.isArray(protocol.endpoint_types) ||
      !Array.isArray(protocol.options || []) ||
      !Array.isArray(protocol.models)
    ) {
      throw new Error(`协议 ${protocol.id} 的动态 schema 格式无效`);
    }
    const optionKeys = new Set();
    (protocol.options || []).forEach((option) => {
      if (
        !option ||
        typeof option !== 'object' ||
        Array.isArray(option) ||
        typeof option.key !== 'string' ||
        !option.key.trim() ||
        optionKeys.has(option.key)
      ) {
        throw new Error(`协议 ${protocol.id} 包含无效或重复的参数定义`);
      }
      optionKeys.add(option.key);
    });
    if (
      protocol.models.some(
        (modelName) => typeof modelName !== 'string' || !modelName.trim(),
      )
    ) {
      throw new Error(`协议 ${protocol.id} 包含无效模型名`);
    }
  });
  return catalog;
};

export const useProtocolCatalog = (enabled = true) => {
  const [protocols, setProtocols] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const response = await API.get('/api/models/protocols');
      const payload = response?.data;
      if (!payload?.success) {
        throw new Error(payload?.message || '协议目录加载失败');
      }
      setProtocols(validateProtocolCatalog(payload.data));
    } catch (requestError) {
      setProtocols([]);
      setError(requestError?.response?.data?.message || requestError.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    protocols,
    loading,
    error,
    reload: load,
  };
};
