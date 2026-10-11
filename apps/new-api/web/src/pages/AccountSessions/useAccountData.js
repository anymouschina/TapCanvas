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

import { useEffect, useRef, useState } from 'react';
import { API } from '../../helpers';

export const accountPageSize = 20;

export function useAccountData(channelId) {
  const [accounts, setAccounts] = useState([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountPage, setAccountPage] = useState(1);
  const [accountTotal, setAccountTotal] = useState(0);
  const [accountStats, setAccountStats] = useState(null);
  const [accountStatus, setAccountStatus] = useState(null);
  const [accountEmail, setEmail] = useState('');
  const [accountError, setAccountError] = useState('');
  const [observedAt, setObservedAt] = useState(null);
  const scope = useRef(channelId);
  const requestedView = useRef({
    page: 1,
    status: accountStatus,
    email: accountEmail,
  });
  if (scope.current !== channelId) {
    requestedView.current = {
      page: 1,
      status: accountStatus,
      email: accountEmail,
    };
  }
  requestedView.current.status = accountStatus;
  requestedView.current.email = accountEmail;
  scope.current = channelId;
  const request = useRef(0);

  const loadAccounts = async (
    id = channelId,
    page = requestedView.current.page,
    status = requestedView.current.status,
    email = requestedView.current.email,
  ) => {
    if (!id || id !== scope.current) return;
    requestedView.current = { page, status, email };
    const sequence = ++request.current;
    setAccountLoading(true);
    setAccountError('');
    try {
      const response = await API.post(
        '/api/channel/multi_key/manage',
        {
          channel_id: id,
          action: 'get_key_status',
          page,
          page_size: accountPageSize,
          ...(status !== null ? { status } : {}),
          ...(email ? { email } : {}),
        },
        { skipErrorHandler: true },
      );
      if (!response.data?.success)
        throw new Error(response.data?.message || '获取账号状态失败');
      if (scope.current !== id || sequence !== request.current) return;
      const data = response.data.data;
      if (
        !data ||
        !Array.isArray(data.keys) ||
        !Number.isInteger(data.total) ||
        data.total < 0 ||
        !Number.isInteger(data.page) ||
        data.page < 1 ||
        ![
          data.enabled_count,
          data.manual_disabled_count,
          data.auto_disabled_count,
        ].every((count) => Number.isInteger(count) && count >= 0)
      ) {
        throw new Error('账号状态响应不完整');
      }
      setAccounts(data.keys);
      setAccountTotal(data.total);
      setAccountPage(data.page);
      requestedView.current.page = data.page;
      setAccountStats({
        enabled: data.enabled_count,
        manual: data.manual_disabled_count,
        automatic: data.auto_disabled_count,
      });
      setObservedAt(new Date());
    } catch (error) {
      if (scope.current === id && sequence === request.current)
        setAccountError(error.message);
    } finally {
      if (scope.current === id && sequence === request.current)
        setAccountLoading(false);
    }
  };

  const setAccountEmail = (value) => {
    const email = value.trim();
    if (email === accountEmail) {
      void loadAccounts(channelId, 1);
      return;
    }
    request.current += 1;
    setAccountLoading(Boolean(channelId));
    setEmail(email);
  };

  useEffect(() => {
    setAccounts([]);
    setAccountStats(null);
    setAccountTotal(0);
    setAccountPage(1);
    setObservedAt(null);
    loadAccounts(channelId, 1);
    return () => {
      request.current += 1;
    };
  }, [channelId, accountStatus, accountEmail]);

  return {
    accounts,
    accountLoading,
    accountPage,
    accountTotal,
    accountStats,
    accountStatus,
    setAccountStatus,
    accountEmail,
    setAccountEmail,
    accountError,
    observedAt,
    loadAccounts,
  };
}
