import { useMemo, useState } from 'react';
import { Download, ListOrdered } from 'lucide-react';
import type { Nav } from '../App';
import { exportWorkday } from '../domain/excel';
import { COUNT_ZERO_STATUSES, STAT_FILTERS, totalItemCount } from '../domain/ledger';
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

// 카드 배치. '_'는 한 칸 띄우기.
const ROW_TOP = ['all', 'completed', 'uncompleted', '_', 'hasItems', 'noItems'];
const ROW_STATUS = ['gte2', 'misongFind', 'exchange', 'exchangePurchase', 'sendBack', '_', 'none', 'allMisong', 'returnOnly', 'purchase'];

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

  // 갯수 없음(처리됐는데 갯수 0)이 어떤 상태에서 나왔는지. 올미송 · 반품만 · 매입처리 · 주문/물건없음은 갯수 0이 정상이고, 그 밖의 상태는 확인이 필요하다.
  const zeroBreakdown = useMemo(() => {
    const rows = f.scoped.filter(STAT_FILTERS.find(x => x.key === 'noItems')!.test);
    const map = new Map<string, number>();
    for (const t of rows) {
      const st = String(t.status || '').trim();
      map.set(st, (map.get(st) || 0) + 1);
    }
    const entries = [...map].map(([status, count]) => ({ status, count, normal: COUNT_ZERO_STATUSES.has(status) }));
    entries.sort((a, b) => Number(b.normal) - Number(a.normal) || b.count - a.count);
    return { total: rows.length, entries, odd: entries.filter(e => !e.normal).reduce((n, e) => n + e.count, 0) };
  }, [f.scoped]);

  const list = useMemo(() => {
    const test = STAT_FILTERS.find(s => s.key === filter)?.test ?? (() => true);
    return f.scoped.filter(test);
  }, [f.scoped, filter]);

  // 첫 줄의 빈칸은 항상, 둘째 줄의 빈칸은 데스크톱에서만 보인다 (모바일 둘째 줄은 5칸씩 두 줄로 나뉨)
  const card = (key: string, i: number, hideGapOnMobile = false) => {
    if (key === '_') return <div key={`gap${i}`} aria-hidden className={hideGapOnMobile ? 'hidden sm:block' : ''} />;
    const c = cards.find(x => x.key === key);
    if (!c) return null;
    return (
      <button key={c.key} type="button" onClick={() => setFilter(c.key)} className={cx('min-h-[44px] rounded-md border px-0.5 py-1 transition', TONES[c.tone], filter === c.key ? 'ring-2 ring-white/40' : 'opacity-70 hover:opacity-100')}>
        <span className="block text-[9px] font-semibold leading-tight tracking-tight">{c.label}</span>
        <span className="text-sm font-black">{c.value}<small className="ml-0.5 text-[9px] font-normal">{c.unit}</small></span>
      </button>
    );
  };

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
          {zeroBreakdown.total > 0 && (
            <p className="flex items-start gap-1.5 border-t border-gray-800 pt-1">
              <span className={cx('mt-px shrink-0 font-black', zeroBreakdown.odd ? 'text-amber-400' : 'text-emerald-400')}>{zeroBreakdown.odd ? '!' : '✓'}</span>
              <span>
                <b className="text-gray-100">갯수 없음 {zeroBreakdown.total}건</b> ={' '}
                {zeroBreakdown.entries.map((e, i) => (
                  <span key={e.status || '(상태없음)'} className={e.normal ? '' : 'font-bold text-amber-300'}>
                    {i > 0 && ' + '}{e.normal ? '' : '⚠ '}{e.status || '(상태 없음)'} {e.count}
                  </span>
                ))}
                {zeroBreakdown.odd > 0 && <span className="block text-amber-300">⚠ 표시 {zeroBreakdown.odd}건은 보통 갯수가 1 이상이어야 하는 상태입니다. "갯수 없음" 카드를 눌러 해당 주문의 갯수를 확인하세요.</span>}
              </span>
            </p>
          )}
        </div>
        {/* 첫 줄: 건수 / (빈칸) / 갯수 있음 · 없음. 둘째 줄: 물건 있는 상태들 / (빈칸) / 물건 없는 상태들 */}
        <div className="grid grid-cols-6 gap-1 text-center">
          {ROW_TOP.map((key, i) => card(key, i))}
        </div>
        <div className="mt-1 grid grid-cols-5 gap-1 text-center sm:grid-cols-10">
          {ROW_STATUS.map((key, i) => card(key, i, true))}
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
