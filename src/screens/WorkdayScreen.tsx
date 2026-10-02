import { memo, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import type { Transaction, User } from '../types';
import type { Nav } from '../App';
import { exportWorkday } from '../domain/excel';
import { formatFloor, formatMoney, formatRoom, parseAmount } from '../domain/format';
import { applyStatus, hasStatus, STATUS_BUTTONS, statusGroup, type StatusGroup } from '../domain/ledger';
import { regionLabel } from '../domain/storeGroups';
import { useApp } from '../state/AppContext';
import { Badge, Button, EmptyState, Screen, cx } from '../components/ui';
import { DayFilterBar, useDayFilter } from './useDayFilter';

const FILTERS = [
  { key: 'all', label: '총 주문', tone: 'border-gray-600 bg-gray-800 text-white', test: () => true },
  { key: 'completed', label: '완료', tone: 'border-emerald-700 bg-emerald-950/60 text-emerald-300', test: hasStatus },
  { key: 'uncompleted', label: '처리 대기', tone: 'border-amber-700 bg-amber-950/60 text-amber-300', test: (t: Transaction) => !hasStatus(t) },
] as const;

// 바쁘게 움직이며 한눈에 구분하도록 버튼 · 카드 색을 상태별로 다르게 둔다
const GROUP_STYLE: Record<StatusGroup, { card: string; active: string; idle: string; badge: string }> = {
  done: {
    card: 'border-green-700 bg-green-950/40',
    active: 'bg-green-600 border-green-400 text-white ring-2 ring-green-400',
    idle: 'border-green-700 bg-green-950/60 text-green-300 hover:bg-green-900',
    badge: 'bg-green-900 text-green-200',
  },
  pending: {
    card: 'border-yellow-700 bg-yellow-950/40',
    active: 'bg-yellow-500 border-yellow-300 text-gray-950 ring-2 ring-yellow-300',
    idle: 'border-yellow-700 bg-yellow-950/60 text-yellow-300 hover:bg-yellow-900',
    badge: 'bg-yellow-900 text-yellow-200',
  },
  return: {
    card: 'border-red-700 bg-red-950/40',
    active: 'bg-red-600 border-red-400 text-white ring-2 ring-red-400',
    idle: 'border-red-700 bg-red-950/60 text-red-300 hover:bg-red-900',
    badge: 'bg-red-900 text-red-200',
  },
};

/** 세부 상태 버튼 색 (원래 앱과 같은 구분) */
const OPTION_STYLE: Record<string, string> = {
  주문찾기: 'bg-green-600 border-green-400 text-white',
  샘플: 'bg-teal-600 border-teal-400 text-white',
  주문없음: 'bg-slate-500 border-slate-300 text-white',
  물건없음: 'bg-slate-600 border-slate-400 text-white',
  '올미송(결제만)': 'bg-orange-600 border-orange-400 text-white',
  '미송(찾기)': 'bg-yellow-500 border-yellow-300 text-gray-950',
  교환: 'bg-blue-600 border-blue-400 text-white',
  반품만: 'bg-rose-600 border-rose-400 text-white',
  반송: 'bg-slate-600 border-slate-400 text-white',
  '교환/매입': 'bg-fuchsia-600 border-fuchsia-400 text-white',
  매입처리: 'bg-emerald-600 border-emerald-400 text-white',
};

/** 사입삼촌 주문처리: 건물·층 동선 순서로 주문을 보며 상태·대납금·갯수를 입력 */
export function WorkdayScreen({ nav }: { nav: Nav }) {
  const { user } = useApp();
  const f = useDayFilter(nav.date, user!);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const list = useMemo(() => f.scoped.filter(FILTERS.find(x => x.key === filter)!.test), [f.scoped, filter]);
  const totalExpense = useMemo(() => f.scoped.reduce((s, t) => s + (Number(t.expense) || 0), 0), [f.scoped]);

  return (
    <Screen
      title="주문처리"
      badge={<Badge className="bg-sky-900/60 text-sky-200">{user!.name}</Badge>}
      subtitle="건물 · 층 순서로 정렬됩니다. 상태 · 대납금 · 물건 갯수는 입력 즉시 저장됩니다."
      onClose={() => nav.setView(null)}
      width="max-w-4xl"
      actions={
        <>
          <Button tone="primary" onClick={nav.newOrder}><Plus className="h-4 w-4" />신규 주문</Button>
          <Button tone="success" onClick={() => exportWorkday(list, nav.date, user!.name)} disabled={list.length === 0}><Download className="h-4 w-4" />엑셀 저장</Button>
        </>
      }
    >
      <DayFilterBar date={nav.date} onDate={nav.setDate} f={f} />

      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2 text-xs text-gray-400">
          <span>범위: <b className="text-white">{f.building || '전체 건물'}{f.floor && ` ${f.floor}층`}</b> · 목록 <b className="text-yellow-300">{list.length}</b>건</span>
          <span>대납 합계 <b className="text-sm text-rose-400">{formatMoney(totalExpense)}</b></span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {FILTERS.map(x => (
            <button key={x.key} type="button" onClick={() => setFilter(x.key)} className={cx('rounded-lg border min-h-[48px] py-1.5 transition', x.tone, filter === x.key ? 'ring-2 ring-white/40' : 'opacity-70')}>
              <span className="block text-[10px] font-semibold">{x.label}</span>
              <span className="text-base font-black">{f.scoped.filter(x.test).length}<small className="ml-0.5 text-[10px] font-normal">건</small></span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {list.length === 0 ? <EmptyState>해당 조건의 주문이 없습니다.</EmptyState> : list.map(t => <WorkOrderCard key={t.id} t={t} me={user!} />)}
      </div>

      {list.length > 0 && (
        <div className="mt-8 border-t border-gray-800 pt-6 text-center">
          <Button tone="success" size="lg" className="w-full max-w-md" onClick={() => exportWorkday(list, nav.date, user!.name)}>
            <Download className="h-5 w-5" />현재 목록 엑셀 저장 ({list.length}건)
          </Button>
        </div>
      )}
    </Screen>
  );
}

const WorkOrderCard = memo(function WorkOrderCard({ t, me }: { t: Transaction; me: User }) {
  const { saveOrders, patchOrderLocal, notify, markets } = useApp();
  const region = regionLabel(t, markets);
  const [openGroup, setOpenGroup] = useState<StatusGroup | null>(null);
  const group = statusGroup(t.status);

  const save = (next: Transaction) => {
    patchOrderLocal(next);
    saveOrders([next]).catch(e => notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'));
  };
  const saveField = (patch: Partial<Transaction>) => save({ ...t, ...patch, actualManager: me.name || t.actualManager || t.manager });
  const setStatus = (status: string) => {
    setOpenGroup(null);
    save(applyStatus(t, status, me.name));
  };
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();

  return (
    <article className={cx('rounded-xl border p-3.5 shadow-md', group ? GROUP_STYLE[group].card : 'border-gray-800 bg-gray-900')}>
      <div className="mb-3 flex flex-col gap-2 border-b border-gray-800 pb-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600 bg-sky-950 px-3 py-1.5 text-sm font-extrabold text-cyan-200 sm:text-base">
            🏢 {t.market || '건물 미지정'} <span className="text-yellow-300">{formatFloor(t.floor)}</span> <span className="font-mono text-white">{formatRoom(t.room)}</span>
          </span>
          <h2 className="text-lg font-black text-white">{t.store || '상호 미등록'}</h2>
          {region && <Badge className="bg-violet-900/60 text-violet-200">{region}</Badge>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge className={group ? GROUP_STYLE[group].badge : 'bg-amber-950 text-amber-400'}>{hasStatus(t) ? `✓ ${t.status}` : '처리 대기'}</Badge>
          <Badge className="bg-gray-800 text-gray-300">담당: {t.actualManager || t.assignedManager || t.manager || '미배정'}</Badge>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-red-900/70 bg-red-950/30 px-3 text-xs font-bold text-red-300">
          <input type="checkbox" checked={!!t.isReturn} onChange={e => saveField({ isReturn: e.target.checked })} className="h-5 w-5 accent-red-500" />
          반품 있음
        </label>
        <label className="flex flex-col text-[11px] font-semibold text-gray-400">
          물건갯수
          <input
            key={`c${t.itemCount}`}
            type="number"
            inputMode="numeric"
            defaultValue={t.itemCount ?? 0}
            onBlur={e => Number(e.target.value) !== (t.itemCount ?? 0) && saveField({ itemCount: Number(e.target.value) || 0 })}
            onKeyDown={blurOnEnter}
            className="mt-0.5 min-h-[44px] w-20 rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-center text-base font-black text-white outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
        <label className="flex min-w-[150px] flex-1 flex-col text-[11px] font-semibold text-gray-400">
          대납금
          <span className="relative mt-0.5 flex items-center">
            <input
              key={`e${t.expense}`}
              inputMode="numeric"
              defaultValue={t.expense ? t.expense.toLocaleString() : ''}
              onBlur={e => parseAmount(e.target.value) !== (t.expense || 0) && saveField({ expense: parseAmount(e.target.value) })}
              onKeyDown={blurOnEnter}
              placeholder="입력"
              className="min-h-[44px] w-full rounded-lg border border-gray-700 bg-gray-800 p-1.5 pr-14 text-right text-base font-black text-amber-400 outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="pointer-events-none absolute right-2 text-xs text-gray-400">,000원</span>
          </span>
        </label>
      </div>

      {t.remark && <p className="mb-2 whitespace-pre-wrap break-words text-xs text-gray-400">주문내용: <span className="text-gray-200">{t.remark}</span></p>}
      <input
        key={`r${t.processingRemark}`}
        defaultValue={t.processingRemark || ''}
        onBlur={e => e.target.value !== (t.processingRemark || '') && saveField({ processingRemark: e.target.value })}
        onKeyDown={blurOnEnter}
        placeholder="처리 메모 (입력 후 엔터)"
        className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-amber-300 outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-sky-500"
      />

      <div className="border-t border-gray-800 pt-2">
        {openGroup ? (
          <div className="flex flex-wrap gap-2">
            {STATUS_BUTTONS.find(b => b.group === openGroup)!.options.map(option => {
              const disabled = option === '매입처리' && !t.isReturn;
              return (
                <button key={option} type="button" disabled={disabled} onClick={() => setStatus(option)}
                  className={cx('min-w-[64px] flex-1 rounded-lg border min-h-[48px] py-2.5 text-sm font-bold shadow-md hover:brightness-110 disabled:opacity-40', OPTION_STYLE[option] || 'border-gray-600 bg-gray-700 text-white')}>
                  {option}
                </button>
              );
            })}
            <button type="button" onClick={() => setOpenGroup(null)} className="rounded-lg border border-gray-700 bg-gray-900 min-h-[48px] px-4 py-2 text-xs font-bold text-gray-300">취소</button>
          </div>
        ) : (
          <div className="flex gap-2">
            {STATUS_BUTTONS.map(b => {
              const active = group === b.group;
              const disabled = b.group === 'return' && !t.isReturn && !active;
              return (
                <button
                  key={b.group}
                  type="button"
                  disabled={disabled}
                  onClick={() => (active ? setStatus(t.status || '') : setOpenGroup(b.group))}
                  className={cx('min-h-[48px] flex-1 rounded-lg border py-2.5 text-sm font-bold transition disabled:opacity-30', active ? GROUP_STYLE[b.group].active : GROUP_STYLE[b.group].idle)}
                >
                  {active ? t.status : b.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
});
