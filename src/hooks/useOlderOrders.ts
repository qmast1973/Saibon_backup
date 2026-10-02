import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { IS_DEMO } from '../data/firebase';
import { fetchAllOrders } from '../data/orders';
import { filterVisible } from '../domain/access';
import { useApp } from '../state/AppContext';

// 실시간으로 보는 기간(최근 90일) 밖의 오래된 기록은 자주 바뀌지 않으므로, 한 번 받으면 화면을 다시 열어도 다시 받지 않는다
let cache: { before: string; rows: Transaction[] } | null = null;

/**
 * 최근 90일 밖의 오래된 주문 기록 (로그인한 사람이 볼 수 있는 것만).
 * enabled 일 때만 서버에서 받는다. 검색 · 이월 미수금 계산처럼 오래된 기록이 필요한 화면에서 쓴다.
 */
export function useOlderOrders(enabled: boolean) {
  const { user, users, rules, orders, notify } = useApp();
  const windowStart = useMemo(() => orders.reduce((min, t) => (t.date && (!min || t.date < min) ? t.date : min), ''), [orders]);
  const [older, setOlder] = useState(cache);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || IS_DEMO || !windowStart || older?.before === windowStart) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetchAllOrders(undefined, windowStart)
      .then(r => {
        cache = { before: windowStart, rows: r.orders };
        if (!cancelled) setOlder(cache);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        notify('90일 이전 기록을 불러오지 못했습니다. 최근 90일 기준으로 표시합니다.', 'error');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [enabled, windowStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (older && user ? filterVisible(older.rows, user, users, rules) : []), [older, user, users, rules]);
  return { rows, loading, failed };
}
