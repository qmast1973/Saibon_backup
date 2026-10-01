import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { Nav } from '../App';
import { exportWorkday } from '../domain/excel';
import { formatMoney } from '../domain/format';
import { STAT_FILTERS, totalItemCount } from '../domain/ledger';
import { buildStoreGroups } from '../domain/storeGroups';
import { useApp } from '../state/AppContext';
import { StoreGroupTable } from '../components/StoreGroupTable';
import { Badge, Button, Screen, cx } from '../components/ui';
import { DayFilterBar, useDayFilter } from './useDayFilter';

const TONES: Record<string, string> = {
  slate: 'border-gray-600 bg-gray-800 text-gray-100',
  emerald: 'border-emerald-700 bg-emerald-950/60 text-emerald-300',
  amber: 'border-amber-700 bg-amber-950/60 text-amber-300',
  cyan: 'border-cyan-700 bg-cyan-950/60 text-cyan-300',
  indigo: 'border-indigo-700 bg-indigo-950/60 text-indigo-300',
  yellow: 'border-yellow-700 bg-yellow-950/60 text-yellow-300',
  orange: 'border-orange-700 bg-orange-950/60 text-orange-300',
  rose: 'border-rose-700 bg-rose-950/60 text-rose-300',
  pink: 'border-pink-700 bg-pink-950/60 text-pink-300',
  fuchsia: 'border-fuchsia-700 bg-fuchsia-950/60 text-fuchsia-300',
  purple: 'border-purple-700 bg-purple-950/60 text-purple-300',
};

/** 갯수 집계: 처리 상태별 건수와 거래처별 물건 갯수 */
export function StatsScreen({ nav }: { nav: Nav }) {
  const { user, users, rules, includeFee } = useApp();
  const f = useDayFilter(nav.date, user!);
  const [filter, setFilter] = useState('all');

  const cards = useMemo(() => {
    const list = STAT_FILTERS.map(s => ({ key: s.key, label: s.label, unit: s.unit, tone: s.tone, value: f.scoped.filter(s.test).length }));
    list.splice(3, 0, { key: 'items', label: '물건 갯수합계', unit: '개', tone: 'cyan', value: totalItemCount(f.scoped) });
    return list;
  }, [f.scoped]);

  const list = useMemo(() => {
    if (filter === 'items') return f.scoped.filter(t => (Number(t.itemCount) || 0) !== 0);
    const test = STAT_FILTERS.find(s => s.key === filter)?.test ?? (() => true);
    return f.scoped.filter(test);
  }, [f.scoped, filter]);

  const groups = useMemo(() => buildStoreGroups(list, { mode: 'stats', rules, users, includeFee }), [list, rules, users, includeFee]);
  const totalExpense = useMemo(() => f.scoped.reduce((s, t) => s + (Number(t.expense) || 0), 0), [f.scoped]);

  return (
    <Screen
      title="갯수 집계"
      badge={<Badge className="bg-pink-900/60 text-pink-200">{user!.name}</Badge>}
      subtitle="처리 상태별 건수와 거래처별 물건 갯수를 확인합니다. 카드를 누르면 목록이 걸러집니다."
      onClose={() => nav.setView(null)}
      actions={<Button tone="success" onClick={() => exportWorkday(list, nav.date, user!.name)} disabled={list.length === 0}><Download className="h-4 w-4" />엑셀 저장</Button>}
    >
      <DayFilterBar date={nav.date} onDate={nav.setDate} f={f} />

      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2 text-xs text-gray-400">
          <span>범위: <b className="text-white">{f.building || '전체 건물'}{f.floor && ` ${f.floor}층`}</b> · 목록 <b className="text-yellow-300">{list.length}</b>건</span>
          <span>대납 합계 <b className="text-sm text-rose-400">{formatMoney(totalExpense)}</b></span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center sm:grid-cols-4 md:grid-cols-6">
          {cards.map(c => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key)} className={cx('rounded-lg border px-0.5 py-1.5 transition', TONES[c.tone], filter === c.key ? 'ring-2 ring-white/40' : 'opacity-70 hover:opacity-100')}>
              <span className="block text-[10px] font-semibold tracking-tight">{c.label}</span>
              <span className="text-base font-black">{c.value}<small className="ml-0.5 text-[10px] font-normal">{c.unit}</small></span>
            </button>
          ))}
        </div>
      </div>

      <StoreGroupTable groups={groups} mode="stats" onOpenOrder={t => nav.open({ type: 'order', tx: t })} />
    </Screen>
  );
}
