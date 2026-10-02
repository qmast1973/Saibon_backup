import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Layers, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { Transaction } from '../types';
import type { Nav } from '../App';
import { canSeeItemCounts } from '../domain/access';
import { getBusinessDate, getKoreanHolidays } from '../domain/dates';
import { formatLocation, formatMoney } from '../domain/format';
import { getBillingStore, getMerchantBundle, getSubStores, matchesTransaction, sortByStoreFocus } from '../domain/groups';
import { hasStatus, isReceivable, splitAmounts } from '../domain/ledger';
import { compact, fuzzyIncludes, uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Badge, Button, ConfirmDialog, EmptyState, StoreSearch, cx } from '../components/ui';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function MainScreen({ nav }: { nav: Nav }) {
  const { user, visibleOrders, rules, orders } = useApp();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [bundleFilter, setBundleFilter] = useState('all');

  const isMerchant = user?.role === 'merchant';
  const stores = useMemo(() => uniqueSorted(visibleOrders.map(t => t.store)), [visibleOrders]);
  const bundle = useMemo(
    () => (isMerchant && user ? getMerchantBundle(user, rules, uniqueSorted(orders.map(o => o.store))) : []),
    [isMerchant, user, rules, orders],
  );

  const filtered = useMemo(() => {
    let list = visibleOrders;
    if (isMerchant && bundleFilter !== 'all') {
      const f = compact(bundleFilter);
      list = list.filter(t => {
        const s = compact(t.store);
        return s === f || s.includes(f) || f.includes(s);
      });
    }
    if (deferredQuery.trim()) list = list.filter(t => matchesTransaction(t, deferredQuery, rules));
    return list;
  }, [visibleOrders, isMerchant, bundleFilter, deferredQuery, rules]);

  // 관리자가 대표거래처명으로 검색하면 어떤 종속 거래처가 함께 잡히는지 알려 준다
  const searchedGroup = useMemo(() => {
    if (user?.role !== 'admin' || !deferredQuery.trim()) return null;
    const rule = rules.find(r => r.groupName && fuzzyIncludes(r.groupName, deferredQuery));
    return rule ? { name: rule.groupName.trim(), subs: getSubStores(rule.groupName, rules) } : null;
  }, [user?.role, deferredQuery, rules]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 p-3">
      {isMerchant && bundle.length > 1 && (
        <section className="flex flex-col gap-2.5 rounded-2xl border border-violet-800/60 bg-violet-950/50 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 shrink-0 text-violet-300" />
            <div>
              <p className="text-sm font-bold text-gray-100">대표거래처 통합 주문 <Badge className="ml-1 bg-violet-900 text-violet-200">{bundle.length}개 상호</Badge></p>
              <p className="text-[11px] text-gray-400">묶인 상호의 주문이 함께 보입니다. 상호를 누르면 그 상호만 봅니다.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['all', ...bundle].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setBundleFilter(s)}
                className={cx('rounded-xl px-3 py-1.5 font-bold', bundleFilter === s ? 'bg-violet-600 text-white ring-2 ring-violet-400' : 'border border-gray-700 bg-gray-900 text-gray-300')}
              >
                {s === 'all' ? '전체' : s}
                {s !== 'all' && compact(s) === compact(user?.storeName) && <span className="ml-1 text-[9px] opacity-80">대표</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="flex items-center gap-2 rounded-2xl border border-gray-800 bg-gray-900 p-2">
        <div className="max-w-md flex-1">
          <StoreSearch value={query} onChange={setQuery} knownStores={stores} rules={rules} placeholder="상호, 대표거래처, 건물, 비고, 담당자 (초성 가능)" />
        </div>
      </section>

      {searchedGroup && (
        <section className="rounded-xl border border-violet-700/70 bg-violet-950/60 px-3 py-2 text-xs text-violet-200">
          <Layers className="mr-1 inline h-3.5 w-3.5" />
          대표거래처 <b className="text-white">'{searchedGroup.name}'</b> 검색 중 — 종속 거래처({searchedGroup.subs.join(', ') || '없음'}) 포함 {filtered.length}건
        </section>
      )}

      <CalendarView nav={nav} orders={filtered} />
    </main>
  );
}

function CalendarView({ nav, orders }: { nav: Nav; orders: Transaction[] }) {
  const { user, rules, deleteOrder, saveOrders, notify } = useApp();
  const [month, setMonth] = useState(() => {
    const [y, m] = nav.date.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [focusStore, setFocusStore] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Transaction | null>(null);

  // 다른 화면에서 날짜를 바꾸면 달력도 그 달로 이동
  useEffect(() => {
    const [y, m] = nav.date.split('-').map(Number);
    setMonth(prev => (prev.getFullYear() === y && prev.getMonth() === m - 1 ? prev : new Date(y, m - 1, 1)));
  }, [nav.date]);

  const year = month.getFullYear();
  const mon = month.getMonth();
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    getKoreanHolidays(year).then(h => alive && setHolidays(h)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [year]);
  const isMerchant = user?.role === 'merchant';

  const dayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of orders) map[t.date] = (map[t.date] || 0) + 1;
    return map;
  }, [orders]);

  const dayOrders = useMemo(() => sortByStoreFocus(orders.filter(t => t.date === nav.date), focusStore, rules), [orders, nav.date, focusStore, rules]);
  const totals = useMemo(() => {
    let billed = 0, paid = 0;
    for (const t of dayOrders) {
      if (isReceivable(t)) continue;
      const a = splitAmounts(t);
      billed += a.billed;
      paid += a.paid;
    }
    return { billed, paid };
  }, [dayOrders]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const list: number[] = [];
    for (let y = Math.min(2022, year); y <= Math.max(now + 3, year); y++) list.push(y);
    return list;
  }, [year]);

  const firstDay = new Date(year, mon, 1).getDay();
  const lastDate = new Date(year, mon + 1, 0).getDate();
  const trailing = (7 - ((firstDay + lastDate) % 7)) % 7;
  const pad = (n: number) => String(n).padStart(2, '0');

  const selectDay = (dateStr: string) => {
    nav.setDate(dateStr);
    // 상인이 빈 날짜를 누르면 바로 주문 입력
    if (isMerchant && !dayCounts[dateStr]) nav.newOrder();
  };

  const goToday = () => {
    const today = getBusinessDate();
    nav.setDate(today);
    const [y, m] = today.split('-').map(Number);
    setMonth(new Date(y, m - 1, 1));
  };

  const markFound = async (t: Transaction) => {
    try {
      await saveOrders([{ ...t, status: '주문찾기', actualManager: user?.name || t.actualManager }]);
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-3 lg:flex-row">
      {/* 달력 (스와이프 월 이동은 오작동 방지를 위해 넣지 않음) */}
      <div className="flex flex-1 flex-col rounded-2xl border border-gray-800 bg-gray-900 p-3 sm:p-4">
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-0.5 text-base font-black sm:text-xl">
              <select value={year} onChange={e => setMonth(new Date(Number(e.target.value), mon, 1))} className="cursor-pointer rounded-lg bg-transparent px-1 outline-none hover:bg-gray-800" aria-label="연도">
                {years.map(y => <option key={y} value={y} className="bg-gray-900">{y}년</option>)}
              </select>
              <select value={mon} onChange={e => setMonth(new Date(year, Number(e.target.value), 1))} className="cursor-pointer rounded-lg bg-transparent px-1 outline-none hover:bg-gray-800" aria-label="월">
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i} className="bg-gray-900">{pad(i + 1)}월</option>)}
              </select>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" onClick={() => setMonth(new Date(year, mon - 1, 1))} aria-label="이전 달"><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="sm" onClick={() => setMonth(new Date(year, mon + 1, 1))} aria-label="다음 달"><ChevronRight className="h-4 w-4" /></Button>
              <Button size="sm" tone="primary" onClick={goToday}>오늘</Button>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" tone="primary" onClick={() => nav.open({ type: 'quick' })}><Sparkles className="h-3.5 w-3.5" />빠른주문</Button>
            <Button size="sm" onClick={nav.newOrder}><Plus className="h-3.5 w-3.5" />{isMerchant ? '주문 추가' : '신규 입력'}</Button>
            {canSeeItemCounts(user) && (
              <Button size="sm" className="border-pink-800 bg-pink-950 text-pink-200 hover:bg-pink-900" onClick={() => nav.setView('stats')}>
                <BarChart3 className="h-3.5 w-3.5" />갯수 집계
              </Button>
            )}
          </div>
        </div>

        <div className="mb-1.5 grid grid-cols-7 gap-1 border-b border-gray-800 py-2 text-center text-xs font-bold">
          {WEEKDAYS.map((w, i) => <div key={w} className={i === 0 ? 'text-rose-400' : i === 6 ? 'text-sky-400' : 'text-gray-400'}>{w}</div>)}
        </div>
        <div className="grid flex-1 grid-cols-7 gap-1 sm:gap-1.5">
          {Array.from({ length: firstDay }, (_, i) => <div key={`p${i}`} className="min-h-[56px] rounded-xl bg-gray-950/40 sm:min-h-[72px]" />)}
          {Array.from({ length: lastDate }, (_, i) => {
            const d = i + 1;
            const dateStr = `${year}-${pad(mon + 1)}-${pad(d)}`;
            const holiday = holidays[dateStr];
            const count = dayCounts[dateStr] || 0;
            const dow = (firstDay + i) % 7;
            const selected = dateStr === nav.date;
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => selectDay(dateStr)}
                className={cx(
                  'relative flex min-h-[56px] flex-col items-end justify-end rounded-xl border p-1.5 text-left transition sm:min-h-[72px]',
                  selected ? 'z-10 border-indigo-400 bg-indigo-950 ring-2 ring-indigo-500' : count > 0 ? 'border-gray-700 bg-gray-800/60 hover:bg-gray-800' : 'border-gray-800 bg-gray-900 hover:bg-gray-800/60',
                )}
              >
                <span className={cx('absolute left-1.5 top-1 flex flex-col items-start', dow === 0 || holiday ? 'text-rose-400' : dow === 6 ? 'text-sky-400' : 'text-gray-200')}>
                  <span className="text-[13px] font-black leading-none sm:text-[15px]">{d}</span>
                  {holiday && <span className="mt-0.5 max-w-[40px] truncate text-[9px] font-bold leading-none opacity-90 sm:max-w-[64px]" title={holiday}>{holiday}</span>}
                </span>
                {count > 0 && <span className="mt-4 whitespace-nowrap rounded-md bg-indigo-600 px-1 py-0.5 text-[10px] font-bold text-white sm:px-1.5 sm:text-xs">{count}건</span>}
              </button>
            );
          })}
          {Array.from({ length: trailing }, (_, i) => <div key={`n${i}`} className="min-h-[56px] rounded-xl bg-gray-950/40 sm:min-h-[72px]" />)}
        </div>
      </div>

      {/* 선택한 날짜 내역 */}
      <div className="flex w-full flex-col gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-3 sm:p-4 lg:w-96">
        <h3 className="flex items-center gap-2 border-b border-gray-800 pb-2.5 text-sm font-bold">
          <CalendarCheck className="h-5 w-5 text-indigo-400" /> {nav.date} 사입 내역
        </h3>
        <div className="grid grid-cols-3 rounded-xl border border-gray-800 bg-gray-950 p-2.5 text-center text-xs">
          <div><p className="text-[11px] text-gray-500">대납 합계</p><p className="font-bold text-rose-400">{formatMoney(totals.billed)}</p></div>
          <div className="border-x border-gray-800"><p className="text-[11px] text-gray-500">입금 합계</p><p className="font-bold text-sky-400">{formatMoney(totals.paid)}</p></div>
          <div><p className="text-[11px] text-gray-500">건수</p><p className="font-bold">{dayOrders.length}건</p></div>
        </div>

        {focusStore && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-800 bg-violet-950/60 px-2.5 py-1.5 text-xs text-violet-200">
            <span className="truncate"><Layers className="mr-1 inline h-3.5 w-3.5" />'{focusStore}' 묶음을 위로 정렬</span>
            <button type="button" onClick={() => setFocusStore(null)} className="flex min-h-[36px] shrink-0 items-center gap-0.5 font-bold"><X className="h-3.5 w-3.5" />해제</button>
          </div>
        )}

        <div className="max-h-[520px] flex-1 space-y-2 overflow-y-auto pr-1">
          {dayOrders.length === 0 ? (
            <EmptyState icon={<CalendarCheck className="h-8 w-8" />}>
              선택한 날짜의 내역이 없습니다.
              <div className="mt-3"><Button size="sm" tone="primary" onClick={nav.newOrder}><Plus className="h-3.5 w-3.5" />주문 입력</Button></div>
            </EmptyState>
          ) : (
            dayOrders.map(t => (
              <DayOrderCard
                key={t.id}
                t={t}
                billing={rules.length ? getBillingStore(t.store, rules) : ''}
                focused={!!focusStore && (focusStore === t.store || compact(getBillingStore(focusStore, rules)) === compact(getBillingStore(t.store, rules)))}
                onFocus={() => setFocusStore(prev => (prev === t.store ? null : t.store))}
                canComplete={user?.role === 'buyer' && !hasStatus(t)}
                canDelete={user?.role === 'admin'}
                onComplete={() => markFound(t)}
                onEdit={() => nav.open({ type: 'order', tx: t })}
                onDelete={() => setToDelete(t)}
              />
            ))
          )}
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          title="주문 삭제"
          message={`${toDelete.store} · ${formatLocation(toDelete)}\n이 내역을 삭제할까요? 삭제하면 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            deleteOrder(toDelete).catch(e => notify(e.message, 'error'));
            setToDelete(null);
          }}
        />
      )}
    </section>
  );
}

function DayOrderCard({
  t, billing, focused, onFocus, canComplete, canDelete, onComplete, onEdit, onDelete,
}: {
  t: Transaction;
  billing: string;
  focused: boolean;
  onFocus: () => void;
  canComplete: boolean;
  canDelete: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const done = hasStatus(t);
  const isSub = billing && compact(billing) !== compact(t.store);
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-xl border p-2.5 text-xs', done ? 'border-emerald-900 bg-emerald-950/30' : 'border-gray-800 bg-gray-950', focused && 'ring-2 ring-violet-500/60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onFocus} className="inline-flex min-h-[36px] items-center text-sm font-bold text-gray-100 hover:text-indigo-300 hover:underline" title="이 거래처 묶음을 위로 정렬">
            {t.store || '상호 미지정'}
          </button>
          {isSub && <Badge className="bg-violet-900/70 text-violet-200"><Layers className="h-2.5 w-2.5" />대표: {billing}</Badge>}
          {t.manager && <Badge className="bg-indigo-900/70 text-indigo-200">{t.manager}</Badge>}
          <Badge className={done ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900/70 text-amber-200'}>{t.status || '처리 대기'}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canComplete && (
            <button type="button" onClick={onComplete} className="flex items-center gap-0.5 rounded-md border border-emerald-800 bg-emerald-950 min-h-[36px] px-2.5 py-1 text-[11px] font-bold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />완료처리
            </button>
          )}
          <button type="button" onClick={onEdit} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:text-indigo-300" aria-label="수정"><Pencil className="h-3.5 w-3.5" /></button>
          {canDelete && <button type="button" onClick={onDelete} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:text-rose-400" aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        <b className="text-gray-200">{formatLocation(t) || '-'}</b>
        {t.region && <span className="text-gray-500"> · {t.region}</span>}
      </p>
      <div className="flex justify-between border-t border-gray-800 pt-1 font-semibold">
        <span className="text-rose-400">대납 {formatMoney(t.expense)}</span>
        <span className="text-sky-400">입금 {formatMoney(t.income)}</span>
      </div>
      {(t.remark || t.processingRemark) && (
        <p className="rounded-lg border border-gray-800 bg-gray-900 p-1.5 text-[11px] text-gray-400">비고: {[t.remark, t.processingRemark].filter(Boolean).join(' | ')}</p>
      )}
    </div>
  );
}
