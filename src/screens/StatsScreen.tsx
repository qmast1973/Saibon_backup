import { useMemo, useState } from 'react';
import { Download, ListOrdered } from 'lucide-react';
import type { Nav } from '../App';
import { exportWorkday } from '../domain/excel';
import { STAT_FILTERS, totalItemCount } from '../domain/ledger';
import { applyStoreOrder, buildStoreGroups, moveInOrder } from '../domain/storeGroups';
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
  sky: 'border-sky-700 bg-sky-950/60 text-sky-300',
};

/** 갯수 집계: 처리 상태별 건수와 거래처별 물건 갯수 */
export function StatsScreen({ nav }: { nav: Nav }) {
  const { user, users, rules, includeFee, saveStoreOrder, notify } = useApp();
  const f = useDayFilter(nav.date, user!);
  const [filter, setFilter] = useState('all');
  const [editingOrder, setEditingOrder] = useState(false);

  const cards = useMemo(() => {
    return STAT_FILTERS.map(s => ({ key: s.key, label: s.label, unit: s.unit, tone: s.tone, value: f.scoped.filter(s.test).length }));
  }, [f.scoped]);
  const itemTotal = useMemo(() => totalItemCount(f.scoped), [f.scoped]);
  // 눈으로 맞춰 볼 수 있는 검산: 총 = 완료 + 미처리, 완료 = 갯수 있음 + 갯수 없음, 갯수 합계 = 갯수 있음인 주문의 갯수를 더한 값
  const checks = useMemo(() => {
    const n = (key: string) => f.scoped.filter(STAT_FILTERS.find(s => s.key === key)!.test).length;
    const all = f.scoped.length, done = n('completed'), todo = n('uncompleted'), has = n('hasItems'), none = n('noItems');
    const hasRows = f.scoped.filter(STAT_FILTERS.find(s => s.key === 'hasItems')!.test);
    return [
      { label: '총 주문', ok: all === done + todo, text: `${all}건 = 완료 ${done}건 + 미처리 ${todo}건` },
      { label: '완료', ok: done === has + none, text: `${done}건 = 갯수 있음 ${has}건 + 갯수 없음 ${none}건` },
      { label: '물건 갯수 합계', ok: itemTotal === hasRows.reduce((sum, t) => sum + (Number(t.itemCount) || 0), 0), text: `${itemTotal}개 (갯수 있음 ${has}건의 갯수를 더한 값, 갯수 없음 ${none}건은 0개)` },
    ];
  }, [f.scoped, itemTotal]);

  const list = useMemo(() => {
    const test = STAT_FILTERS.find(s => s.key === filter)?.test ?? (() => true);
    return f.scoped.filter(test);
  }, [f.scoped, filter]);

  const savedOrder = user!.storeOrder;
  // 본인이 정한 거래처 순서(들르는 순서)대로 보여 준다. 정한 적이 없으면 기본 순서.
  const groups = useMemo(
    () => applyStoreOrder(buildStoreGroups(list, { mode: 'stats', rules, users, includeFee }), savedOrder),
    [list, rules, users, includeFee, savedOrder],
  );
  const moveStore = (store: string, dir: -1 | 1) =>
    saveStoreOrder(moveInOrder(savedOrder, groups.map(g => g.store), store, dir)).catch(e => notify(e instanceof Error ? e.message : '순서를 저장하지 못했습니다.', 'error'));

  return (
    <Screen
      title="갯수 집계"
      badge={<Badge className="bg-pink-900/60 text-pink-200">{user!.name}</Badge>}
      subtitle={user!.role === 'local' ? '받은 물건을 거래처별 갯수와 맞춰 보며 분류하세요. 담당 거래처 주문만 보입니다.' : '처리 상태별 건수와 거래처별 물건 갯수를 확인합니다. 카드를 누르면 목록이 걸러집니다.'}
      onClose={() => nav.setView(null)}
      actions={
        <>
          <Button tone={editingOrder ? 'primary' : 'secondary'} onClick={() => setEditingOrder(v => !v)}>
            <ListOrdered className="h-4 w-4" />{editingOrder ? '순서 편집 끝' : '순서 편집'}
          </Button>
          <Button tone="success" onClick={() => exportWorkday(list, nav.date, user!.name)} disabled={list.length === 0}><Download className="h-4 w-4" />엑셀 저장</Button>
        </>
      }
    >
      <DayFilterBar date={nav.date} onDate={nav.setDate} f={f} />

      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2 text-xs text-gray-400">
          <span>범위: <b className="text-white">{f.building || '전체 건물'}{f.floor && ` ${f.floor}층`}</b> · 목록 <b className="text-yellow-300">{list.length}</b>건</span>
          <span>물건 갯수 합계 <b className="text-sm text-cyan-300">{itemTotal}개</b></span>
        </div>
        <div className="mb-2 space-y-1 rounded-lg border border-gray-800 bg-gray-950 p-2 text-[11px] leading-snug text-gray-300">
          {checks.map(c => (
            <p key={c.label} className="flex items-start gap-1.5">
              <span className={cx('mt-px shrink-0 font-black', c.ok ? 'text-emerald-400' : 'text-rose-400')}>{c.ok ? '✓' : '✗'}</span>
              <span><b className="text-gray-100">{c.label}</b> {c.text}</span>
            </p>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1 text-center sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9">
          {cards.map(c => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key)} className={cx('min-h-[44px] rounded-md border px-0.5 py-1 transition', TONES[c.tone], filter === c.key ? 'ring-2 ring-white/40' : 'opacity-70 hover:opacity-100')}>
              <span className="block text-[9px] font-semibold leading-tight tracking-tight">{c.label}</span>
              <span className="text-sm font-black">{c.value}<small className="ml-0.5 text-[9px] font-normal">{c.unit}</small></span>
            </button>
          ))}
        </div>
      </div>

      {editingOrder && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-700 bg-indigo-950/60 p-3 text-xs text-indigo-100">
          <span>▲▼ 버튼으로 거래처를 <b>들르는 순서대로</b> 옮기세요. 옮기는 즉시 저장되고, 다른 기기에서도 같은 순서로 보입니다.</span>
          {savedOrder && savedOrder.length > 0 && (
            <Button size="sm" onClick={() => saveStoreOrder([]).catch(e => notify(e instanceof Error ? e.message : '순서를 저장하지 못했습니다.', 'error'))}>기본 순서로 되돌리기</Button>
          )}
        </div>
      )}

      <StoreGroupTable groups={groups} mode="stats" onOpenOrder={t => nav.open({ type: 'order', tx: t })} reorder={{ editing: editingOrder, onMove: moveStore }} />
    </Screen>
  );
}
