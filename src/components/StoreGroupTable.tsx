import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Layers, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import type { Transaction } from '../types';
import { formatLocation, formatMoney } from '../domain/format';
import { getSubStores, sortByStoreFocus } from '../domain/groups';
import { hasStatus, isDeposit, isFeeCharged, isOrder, splitAmounts } from '../domain/ledger';
import type { GroupMode, StoreGroup } from '../domain/storeGroups';
import { compact } from '../domain/text';
import { useRowDrag } from '../hooks/useRowDrag';
import { useApp } from '../state/AppContext';
import { Badge, Button, EmptyState, Modal, cx } from './ui';

interface Actions {
  onOpenOrder?: (t: Transaction) => void;
  onToggleFee?: (t: Transaction) => void;
  onEditDeposit?: (t: Transaction) => void;
  onDeleteDeposit?: (t: Transaction) => void;
  onCollect?: (g: StoreGroup) => void;
  /** 갯수 집계: 거래처 순서 직접 정하기 (editing 이면 줄 끝의 손잡이를 꾹 눌러 끌어서 옮긴다) */
  reorder?: { editing: boolean; onDrop: (store: string, toIndex: number) => void };
}

/** 거래처 한 줄에 묶인 주문들의 비고를 중복 없이 '/'로 이어 붙인다 (입금 · 미수금 기록은 제외) */
function remarkOf(rows: Transaction[]): string {
  return [...new Set(rows.filter(isOrder).map(t => String(t.remark || '').trim()).filter(Boolean))].join(' / ');
}

/** 대표 거래처별 합계 표. 행을 누르면 상세 내역, '종속 n곳'을 누르면 종속 거래처별 소계가 펼쳐진다. */
export function StoreGroupTable({ groups, mode, reorder, ...actions }: { groups: StoreGroup[]; mode: GroupMode } & Actions) {
  const { rules } = useApp();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<{ store: string; sub: string | null } | null>(null);
  const detailGroup = detail ? groups.find(g => g.store === detail.store) : undefined;
  const isCollection = mode === 'collection';
  const moving = !!reorder?.editing;
  const drag = useRowDrag({ enabled: moving, keys: groups.map(g => g.store), onDrop: (store, to) => reorder?.onDrop(store, to) });

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full sm:min-w-[620px] whitespace-nowrap text-left text-sm text-gray-300">
            <thead className="border-b border-gray-800 bg-gray-800/50 text-xs text-gray-400">
              <tr>
                {isCollection && <th className="hidden p-3 font-semibold lg:table-cell">지역</th>}
                <th className="p-3 font-semibold">상호</th>
                <th className={cx('hidden p-3 text-center font-semibold', isCollection ? 'lg:table-cell' : 'sm:table-cell')}>주문</th>
                {isCollection ? (
                  <>
                    <th className="hidden p-3 text-right font-semibold lg:table-cell">청구(사입비 포함)</th>
                    <th className="hidden p-3 text-right font-semibold lg:table-cell">입금</th>
                    <th className="p-2 text-right font-semibold sm:p-3">미수금</th>
                  </>
                ) : (
                  <>
                    <th className="p-2 text-right font-semibold sm:p-3">물건 갯수</th>
                    <th className={cx('p-2 font-semibold sm:p-3', moving && 'hidden sm:table-cell')}>비고</th>
                  </>
                )}
                {moving && <th className="w-12 p-1" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {groups.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-gray-500">해당 조건의 내역이 없습니다.</td></tr>
              )}
              {groups.map(g => {
                const subs = getSubStores(g.store, rules);
                const open = expanded[g.store];
                return (
                  <Fragment key={g.store}>
                    <tr
                      ref={drag.rowRef(g.store)}
                      style={drag.rowStyle(g.store)}
                      className={cx(
                        'cursor-pointer transition hover:bg-indigo-950/40',
                        drag.dragKey === g.store && 'bg-indigo-900/90 outline outline-2 outline-indigo-400',
                        drag.dropMark(g.store) === 'before' && 'shadow-[inset_0_3px_0_0_#818cf8]',
                        drag.dropMark(g.store) === 'after' && 'shadow-[inset_0_-3px_0_0_#818cf8]',
                      )}
                      onClick={() => setDetail({ store: g.store, sub: null })}
                    >
                      {isCollection && <td className="hidden p-3 font-semibold lg:table-cell">{g.region}</td>}
                      <td className="whitespace-normal p-2 font-bold text-gray-100 sm:p-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {g.store}
                          {subs.length > 0 && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setExpanded(prev => ({ ...prev, [g.store]: !prev[g.store] }));
                              }}
                              className="inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-md border border-violet-700 bg-violet-950 px-2.5 py-1 text-[11px] font-bold text-violet-200"
                            >
                              <Layers className="h-3 w-3" />종속 {subs.length}곳{open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                        </span>
                        {isCollection && (
                          <span className="mt-1 block text-[11px] font-normal leading-snug lg:hidden">
                            <span className="text-rose-300">청구 {formatMoney(g.billed)}</span>
                            {g.fee > 0 && <span className="text-indigo-300"> (+사입비 {formatMoney(g.fee)})</span>}
                            <span className="text-emerald-300"> · 입금 {formatMoney(g.paid)}</span>
                            {g.isMonthly && <span className="ml-1 rounded border border-emerald-700 px-1 text-emerald-400">월사입</span>}
                          </span>
                        )}
                        <span className={cx('mt-0.5 block text-[10px] font-normal text-gray-500', isCollection && 'lg:hidden')}>{[isCollection ? g.region : g.rows[0]?.market || '', `${g.orderCount}건`].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className={cx('hidden p-3 text-center', isCollection ? 'lg:table-cell' : 'sm:table-cell')}>
                        <b className="text-gray-100">{g.orderCount}건</b>
                        <span className="block whitespace-nowrap text-[10px]"><span className="text-emerald-400">완료 {g.completedCount}</span> / <span className="text-amber-400">미처리 {g.unprocessedCount}</span></span>
                      </td>
                      {isCollection ? (
                        <>
                          <td className="hidden p-3 text-right font-mono text-sm lg:table-cell">
                            <span className="text-rose-400">{formatMoney(g.billed)}</span>
                            {g.fee > 0 && <span className="block font-sans text-[10px] text-indigo-300">+사입비 {formatMoney(g.fee)}</span>}
                            {g.isMonthly && <span className="mt-0.5 inline-block rounded border border-emerald-700 px-1 font-sans text-[10px] text-emerald-400">월사입{g.monthlyAmount ? ` ${g.monthlyAmount.toLocaleString()}원` : ''} 제외</span>}
                          </td>
                          <td className="hidden p-3 text-right font-mono text-sm text-emerald-400 lg:table-cell">{formatMoney(g.paid)}</td>
                          <td className={cx('p-2 text-right font-mono text-xs font-bold sm:p-3 sm:text-sm', g.balance > 0 ? 'text-amber-400' : g.balance < 0 ? 'text-sky-300' : 'text-gray-500')}>
                            {formatMoney(g.balance)}
                            {g.carry !== 0 && <span className="block font-sans text-[10px] font-normal text-sky-300">이월 {formatMoney(g.carry)} 포함</span>}
                            {g.balance < 0 && <span className="block font-sans text-[10px] font-normal text-sky-300">초과 입금</span>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2 text-right text-xs font-bold text-emerald-400 sm:p-3 sm:text-sm">{g.itemCount}개</td>
                          <td className={cx('min-w-[64px] sm:min-w-[110px] whitespace-normal break-words p-2 text-xs font-normal text-gray-300 sm:p-3', moving && 'hidden sm:table-cell')}>{remarkOf(g.rows) || <span className="text-gray-600">-</span>}</td>
                        </>
                      )}
                      {moving && (
                        <td className="p-1 text-center" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label={`${g.store} 순서 옮기기 (꾹 눌러서 끌기)`}
                            {...drag.handleProps(g.store)}
                            className={cx('inline-flex h-12 w-11 cursor-grab items-center justify-center rounded-lg border active:cursor-grabbing', drag.dragKey === g.store ? 'border-indigo-300 bg-indigo-600 text-white' : 'border-gray-600 bg-gray-800 text-gray-300')}
                          >
                            <GripVertical className="h-6 w-6" />
                          </button>
                        </td>
                      )}
                    </tr>
                    {open && subs.map(sub => {
                      const subRows = g.rows.filter(t => compact(t.store) === compact(sub));
                      const sums = subRows.reduce(
                        (acc, t) => {
                          const a = isCollection ? splitAmounts(t) : { billed: Number(t.expense) || 0, paid: Number(t.income) || 0 };
                          return { billed: acc.billed + a.billed, paid: acc.paid + a.paid, items: acc.items + (isOrder(t) && hasStatus(t) ? Number(t.itemCount) || 0 : 0) };
                        },
                        { billed: 0, paid: 0, items: 0 },
                      );
                      const orders = subRows.filter(isOrder);
                      return (
                        <tr key={sub} className="cursor-pointer bg-violet-950/20 text-xs hover:bg-violet-900/30" onClick={() => setDetail({ store: g.store, sub })}>
                          {isCollection && <td className="hidden p-2.5 pl-6 text-gray-500 lg:table-cell">↳</td>}
                          <td className="p-2.5"><span className="flex items-center gap-1.5 font-semibold text-violet-200"><Store className="h-3 w-3 text-cyan-400" />{sub}</span>{isCollection && <span className="mt-0.5 block text-[11px] font-normal text-gray-400 sm:hidden">청구 {formatMoney(sums.billed)} · 입금 {formatMoney(sums.paid)}</span>}</td>
                          <td className={cx('hidden p-2.5 text-center', isCollection ? 'lg:table-cell' : 'sm:table-cell')}>{orders.length}건 <span className="text-[10px] text-gray-500">(완료 {orders.filter(isCollection ? isFeeCharged : hasStatus).length})</span></td>
                          {isCollection ? (
                            <>
                              <td className="hidden p-2.5 text-right font-mono text-rose-400 lg:table-cell">{formatMoney(sums.billed)}</td>
                              <td className="hidden p-2.5 text-right font-mono text-emerald-400 lg:table-cell">{formatMoney(sums.paid)}</td>
                              <td className="p-2.5 text-right text-gray-500">-</td>
                            </>
                          ) : (
                            <>
                              <td className="p-2.5 text-right font-bold text-emerald-400">{sums.items}개</td>
                              <td className={cx('min-w-[64px] sm:min-w-[110px] whitespace-normal break-words p-2.5 text-gray-400', moving && 'hidden sm:table-cell')}>{remarkOf(subRows) || <span className="text-gray-600">-</span>}</td>
                            </>
                          )}
                          {moving && <td />}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            {!isCollection && groups.length > 0 && (
              <tfoot className="border-t-2 border-gray-700 bg-gray-800/60 text-xs font-bold text-gray-100">
                <tr>
                  <td className="p-2 sm:p-3">합계 <span className="font-normal text-gray-400">({groups.length}곳)</span></td>
                  <td className="hidden p-3 text-center sm:table-cell">{groups.reduce((n, g) => n + g.orderCount, 0)}건</td>
                  <td className="p-2 text-right text-sm text-emerald-300 sm:p-3">{groups.reduce((n, g) => n + g.itemCount, 0)}개</td>
                  <td className={cx('p-2 sm:p-3', moving && 'hidden sm:table-cell')} />
                  {moving && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {detail && detailGroup && (
        <StoreOrdersModal
          group={detailGroup}
          mode={mode}
          initialSub={detail.sub}
          onClose={() => setDetail(null)}
          {...actions}
        />
      )}
    </>
  );
}

function StoreOrdersModal({
  group, mode, initialSub, onClose, onOpenOrder, onToggleFee, onEditDeposit, onDeleteDeposit, onCollect,
}: { group: StoreGroup; mode: GroupMode; initialSub: string | null; onClose: () => void } & Actions) {
  const { rules } = useApp();
  const [sub, setSub] = useState<string | null>(initialSub);
  const isCollection = mode === 'collection';
  const done = isCollection ? isFeeCharged : hasStatus;

  const subStores = useMemo(() => {
    const present = group.rows.map(t => String(t.store || '').trim()).filter(s => s && compact(s) !== compact(group.store));
    return [...new Set([...getSubStores(group.store, rules), ...present])];
  }, [group, rules]);

  const shown = useMemo(() => {
    const list = sub ? group.rows.filter(t => compact(t.store) === compact(sub)) : group.rows;
    return sortByStoreFocus(list, sub || group.store, rules);
  }, [group.rows, sub, rules, group.store]);

  const orders = group.rows.filter(isOrder);

  return (
    <Modal
      title={`${group.store} 상세 내역`}
      subtitle={<><span className="text-emerald-400">완료 {orders.filter(done).length}건</span> · <span className="text-amber-400">미처리 {orders.filter(t => !done(t)).length}건</span>{isCollection && <> · 미수금 <b className="text-amber-300">{formatMoney(group.balance)}</b></>}</>}
      icon={<Layers className="h-5 w-5 text-indigo-400" />}
      onClose={onClose}
      size="lg"
      footer={isCollection && onCollect ? <Button tone="success" onClick={() => { onClose(); onCollect(group); }}><Plus className="h-4 w-4" />수금하기</Button> : undefined}
    >
      {subStores.length > 0 && (
        <div className="mb-3 rounded-xl border border-violet-800/70 bg-violet-950/40 p-2.5">
          <p className="mb-1.5 text-xs font-bold text-violet-300">연결된 종속 거래처 {subStores.length}곳</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSub(null)} className={cx('rounded-lg px-2.5 py-1 text-xs font-bold', sub === null ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-300')}>
              전체 ({group.rows.length})
            </button>
            {subStores.map(s => (
              <button key={s} type="button" onClick={() => setSub(sub === s ? null : s)} className={cx('rounded-lg px-2.5 py-1 text-xs font-bold', sub === s ? 'bg-violet-600 text-white' : 'border border-violet-700 bg-violet-950 text-violet-200')}>
                {s} ({group.rows.filter(t => compact(t.store) === compact(s)).length})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shown.length === 0 && <EmptyState>내역이 없습니다.</EmptyState>}
        {shown.map(t => {
          const deposit = isDeposit(t);
          const completed = done(t);
          const { billed, paid } = isCollection ? splitAmounts(t) : { billed: Number(t.expense) || 0, paid: Number(t.income) || 0 };
          return (
            <div key={t.id} className={cx('flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between', !deposit && completed ? 'border-emerald-900 bg-emerald-950/20' : 'border-gray-800 bg-gray-800/40')}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <Badge className={deposit ? 'bg-emerald-900/60 text-emerald-300' : 'bg-gray-700 text-gray-200'}>{t.market || '-'}</Badge>
                {!deposit && (
                  <Badge className={completed ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-400'}>
                    {completed ? '완료' : '미처리'}{t.status && t.status !== '완료' ? ` (${t.status})` : ''}
                  </Badge>
                )}
                {!deposit && <span className="text-[11px] text-gray-400">{formatLocation({ floor: t.floor, room: t.room })}</span>}
                <b className="text-[13px] text-gray-100">{t.store || '상호 없음'}</b>
                {compact(t.store) !== compact(group.store) && <Badge className="bg-violet-900/60 text-violet-200">종속</Badge>}
                {(t.remark || t.processingRemark) && <span className="truncate rounded bg-amber-950 px-1.5 py-0.5 text-[11px] text-amber-200">{[t.remark, t.processingRemark].filter(Boolean).join(' | ')}</span>}
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                {!isCollection && <span className="text-xs text-gray-400">갯수 <b className="text-white">{t.itemCount || 0}</b></span>}
                <span className="min-w-[64px] text-right font-mono text-[13px] font-bold">
                  {billed > 0 ? <span className="text-rose-400">{formatMoney(billed)}</span> : paid > 0 ? <span className="text-emerald-400">+{formatMoney(paid)}</span> : <span className="text-gray-500">0</span>}
                </span>
                {!deposit && onOpenOrder && <Button size="sm" onClick={() => { onClose(); onOpenOrder(t); }}>주문확인</Button>}
                {isCollection && !deposit && onToggleFee && (
                  <Button size="sm" tone={completed ? 'secondary' : 'success'} onClick={() => onToggleFee(t)}>{completed ? '미처리 전환' : '완료 처리'}</Button>
                )}
                {isCollection && deposit && (
                  <>
                    {onEditDeposit && <button type="button" onClick={() => onEditDeposit(t)} className="p-1.5 text-gray-400 hover:text-indigo-300" aria-label="금액 수정"><Pencil className="h-3.5 w-3.5" /></button>}
                    {onDeleteDeposit && <button type="button" onClick={() => onDeleteDeposit(t)} className="p-1.5 text-gray-400 hover:text-rose-400" aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </>
                )}
                {isCollection && <span className="rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300" title="사입담당">{t.actualManager || t.manager || '-'}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
