import { useMemo, useState } from 'react';
import { Building2, Calendar, Layers } from 'lucide-react';
import type { Transaction, User } from '../types';
import { floorKey } from '../domain/format';
import { matchesTransaction } from '../domain/groups';
import { isOrder } from '../domain/ledger';
import { normalizeMarket } from '../domain/markets';
import { sortKo, uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Input, Select, StoreSearch } from '../components/ui';

/** 건물 → 층 → 호수 순 (사입 동선 순서) */
export function sortByRoute(list: Transaction[]): Transaction[] {
  return [...list].sort(
    (a, b) => sortKo(a.market || '', b.market || '') || sortKo(floorKey(a.floor), floorKey(b.floor)) || sortKo(a.room || '', b.room || ''),
  );
}

/**
 * 사입삼촌 작업 화면 공통 필터: 날짜 · 건물 · 층 · 검색.
 * scoped: 상태 필터를 적용하기 전 목록 (상단 집계용)
 */
export function useDayFilter(date: string, user: User) {
  const { visibleOrders, rules } = useApp();
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [query, setQuery] = useState('');

  // 입금 · 미수금 기록은 물건이 아니므로 주문처리 · 갯수 집계에서 뺀다
  const dayOrders = useMemo(() => visibleOrders.filter(t => t.date === date && isOrder(t)), [visibleOrders, date]);

  const buildings = useMemo(
    () => uniqueSorted([...dayOrders.map(t => normalizeMarket(t.market)), ...(user.allowedMarkets || []).map(m => normalizeMarket(m))]),
    [dayOrders, user.allowedMarkets],
  );
  const floors = useMemo(
    () => uniqueSorted(dayOrders.filter(t => !building || normalizeMarket(t.market) === building).map(t => floorKey(t.floor))),
    [dayOrders, building],
  );

  const scoped = useMemo(() => {
    let list = dayOrders;
    if (building) list = list.filter(t => normalizeMarket(t.market) === building);
    if (floor) list = list.filter(t => floorKey(t.floor) === floor);
    if (query.trim()) list = list.filter(t => matchesTransaction(t, query, rules));
    return sortByRoute(list);
  }, [dayOrders, building, floor, query, rules]);

  const reset = () => {
    setBuilding('');
    setFloor('');
  };

  return { dayOrders, scoped, building, floor, query, setBuilding, setFloor, setQuery, buildings, floors, reset };
}

export function DayFilterBar({
  date,
  onDate,
  f,
}: {
  date: string;
  onDate: (d: string) => void;
  f: ReturnType<typeof useDayFilter>;
}) {
  const { rules } = useApp();
  const label = 'mb-1 flex items-center gap-1 text-xs font-bold text-gray-400';
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 rounded-xl border border-gray-800 bg-gray-900 p-3 sm:grid-cols-4">
      <label>
        <span className={label}><Calendar className="h-3.5 w-3.5 text-sky-400" />날짜</span>
        <Input type="date" value={date} onChange={e => { onDate(e.target.value); f.reset(); }} />
      </label>
      <label>
        <span className={label}><Building2 className="h-3.5 w-3.5 text-sky-400" />건물</span>
        <Select value={f.building} onChange={e => { f.setBuilding(e.target.value); f.setFloor(''); }}>
          <option value="">전체 건물</option>
          {f.buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </Select>
      </label>
      <label>
        <span className={label}><Layers className="h-3.5 w-3.5 text-sky-400" />층</span>
        <Select value={f.floor} onChange={e => f.setFloor(e.target.value)}>
          <option value="">전체 층</option>
          {f.floors.map(x => <option key={x} value={x}>{x}층</option>)}
        </Select>
      </label>
      <div>
        <span className={label}>검색</span>
        <StoreSearch value={f.query} onChange={f.setQuery} knownStores={uniqueSorted(f.dayOrders.map(t => t.store))} rules={rules} placeholder="상호/호수/메모 (초성)" />
      </div>
    </div>
  );
}
