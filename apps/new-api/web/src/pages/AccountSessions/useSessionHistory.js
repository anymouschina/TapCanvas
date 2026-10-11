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

import { useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../../helpers';
import { aggregateSessionLogs, mergeSessionLogs } from './session-history';

export function useSessionHistory(channelId) {
  const [logs, setLogs] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [total, setTotal] = useState(0);
  const cursor = useRef({ page: 0, until: 0 });
  const scope = useRef(channelId);
  scope.current = channelId;
  const request = useRef(0);
  const sessions = useMemo(() => aggregateSessionLogs(logs), [logs]);

  const loadSessions = async (id = channelId, append = false) => {
    if (!id || id !== scope.current) return;
    const sequence = ++request.current;
    const page = append ? cursor.current.page + 1 : 1;
    const until = append ? cursor.current.until : Math.floor(Date.now() / 1000);
    setSessionLoading(true);
    setSessionError('');
    try {
      const response = await API.get('/api/log/', {
        params: {
          type: 2,
          channel: id,
          p: page,
          page_size: 100,
          end_timestamp: until,
        },
        skipErrorHandler: true,
      });
      if (!response.data?.success)
        throw new Error(response.data?.message || '获取会话历史失败');
      const data = response.data.data;
      if (
        !data ||
        !Array.isArray(data.items) ||
        !Number.isInteger(data.total) ||
        data.total < 0
      ) {
        throw new Error('会话日志响应不完整');
      }
      const incoming = data.items;
      // Validate log metadata before committing state, so malformed evidence
      // produces a visible error instead of a render-time crash or empty success.
      aggregateSessionLogs(incoming);
      if (scope.current !== id || sequence !== request.current) return;
      setLogs((previous) => mergeSessionLogs(append ? previous : [], incoming));
      setTotal(data.total);
      cursor.current = { page, until };
    } catch (error) {
      if (scope.current === id && sequence === request.current)
        setSessionError(error.message);
    } finally {
      if (scope.current === id && sequence === request.current)
        setSessionLoading(false);
    }
  };

  useEffect(() => {
    setLogs([]);
    setTotal(0);
    cursor.current = { page: 0, until: 0 };
    loadSessions(channelId);
    return () => {
      request.current += 1;
    };
  }, [channelId]);

  return {
    sessions,
    sessionLoading,
    sessionError,
    loadSessions,
    sessionLogCount: logs.length,
    sessionLogTotal: total,
    hasMoreSessions: logs.length < total,
  };
}
