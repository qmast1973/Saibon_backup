import { useMemo, useState, type FormEvent } from 'react';
import { HandCoins, Layers, ListOrdered, Plus } from 'lucide-react';
import type { Transaction } from '../types';
import type { Nav } from '../App';
import { isAdmin } from '../domain/access';
import { useOlderOrders } from '../hooks/useOlderOrders';
import { formatMoney } from '../domain/format';
import { getBillingStore, getSubStores, matchesTransaction } from '../domain/groups';
import { isFeeCharged, isFeeWaived, isOrder, isReceivable, setFeeWaived, splitAmounts, toggleFeeCharged } from '../domain/ledger';
import { DEPOSIT_MARKET } from '../domain/markets';
import { applyStoreOrder, buildStoreGroups, computeCarryOver, moveToIndex, type CarryOver, type StoreGroup } from '../domain/storeGroups';
import { compact, fuzzyIncludes, uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { StoreGroupTable } from '../components/StoreGroupTable';
import { Badge, Button, ConfirmDialog, Field, Input, Modal, MoneyInput, Screen, Select, StoreSearch, Textarea, cx } from '../components/ui';

type StatusFilter = '' | '미처리' | '완료' | '미수';


/** 수금관리: 날짜별로 거래처(대표 기준) 청구 · 입금 · 미수를 보고 수금을 입력 */
export function CollectionScreen({ nav }: { nav: Nav }) {
  const { user, users, rules, visibleOrders, includeFee, showFeeWaive, markets, saveOrders, patchOrderLocal, deleteOrder, saveStoreOrder, notify } = useApp();
  const [storeQuery, setStoreQuery] = useState('');
  const [buyer, setBuyer] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [editingOrder, setEditingOrder] = useState(false);
  const [entry, setEntry] = useState<{ store: string } | null>(null);
  const [editDeposit, setEditDeposit] = useState<Transaction | null>(null);
  const [deleteDeposit, setDeleteDeposit] = useState<Transaction | null>(null);

  const dayRows = useMemo(() => visibleOrders.filter(t => t.date === nav.date && !isReceivable(t)), [visibleOrders, nav.date]);
  const buyerOf = (t: Transaction) => String(t.actualManager || t.manager || '').trim() || '미지정';

  // 이전 날짜에서 못 받은 금액은 다음 날 수금 화면에 같이 넘어온다
  // 화면은 최근 90일만 실시간으로 받으므로, 그보다 오래된 미수금이 빠지지 않게 오래된 기록은 따로 받아서 이월에 넣는다
  const { rows: olderVisible } = useOlderOrders(true);

  const carry = useMemo(
    () => computeCarryOver([...olderVisible, ...visibleOrders], nav.date, { rules, users, includeFee, markets }),
    [olderVisible, visibleOrders, nav.date, rules, users, includeFee, markets],
  );
  const allGroups = useMemo(() => buildStoreGroups(dayRows, { mode: 'collection', rules, users, includeFee, carry, markets }), [dayRows, rules, users, includeFee, carry, markets]);

  // 필터가 걸려 있으면 그 조건에 맞는 거래처의 이월만 보여 준다 (이월 거래처는 오늘 주문이 없어 담당·처리 상태를 알 수 없다)
  const shownCarry = useMemo<CarryOver>(() => {
    if (buyer || status === '미처리' || status === '완료') return new Map();
    const q = storeQuery.trim();
    if (!q) return carry;
    return new Map([...carry].filter(([store]) => fuzzyIncludes(store, q) || getSubStores(store, rules).some(sub => fuzzyIncludes(sub, q))));
  }, [carry, buyer, status, storeQuery, rules]);

  const filteredRows = useMemo(
    () =>
      dayRows.filter(t => {
        if (storeQuery.trim() && !matchesTransaction(t, storeQuery, rules)) return false;
        if (buyer && buyerOf(t) !== buyer && t.manager !== buyer) return false;
        if (status === '미처리') return isOrder(t) && !isFeeCharged(t) && !isFeeWaived(t);
        if (status === '완료') return isOrder(t) && isFeeCharged(t);
        if (status === '미수') {
          const { billed, paid } = splitAmounts(t);
          return billed - paid > 0;
        }
        return true;
      }),
    [dayRows, storeQuery, buyer, status, rules],
  );
  const savedOrder = user?.collectionOrder;
  // 본인이 정한 거래처 순서(수금 도는 순서)대로 보여 준다. 정한 적이 없으면 지역 · 상호 순서.
  const groups = useMemo(
    () => applyStoreOrder(buildStoreGroups(filteredRows, { mode: 'collection', rules, users, includeFee, carry: shownCarry, markets }), savedOrder),
    [filteredRows, rules, users, includeFee, shownCarry, savedOrder, markets],
  );
  const saveOrder = (order: string[]) =>
    saveStoreOrder(order, 'collectionOrder').catch(e => notify(e instanceof Error ? e.message : '순서를 저장하지 못했습니다.', 'error'));
  const dropStore = (store: string, toIndex: number) => saveOrder(moveToIndex(savedOrder, groups.map(g => g.store), store, toIndex));

  const totals = useMemo(() => {
    const orders = dayRows.filter(isOrder);
    return {
      billed: allGroups.reduce((s, g) => s + g.billed + g.fee, 0),
      orders: orders.length,
      completed: orders.filter(isFeeCharged).length,
      unprocessed: orders.filter(t => !isFeeCharged(t) && !isFeeWaived(t)).length,
      carry: allGroups.reduce((s, g) => s + g.carry, 0),
    };
  }, [dayRows, allGroups]);

  const buyers = useMemo(
    () => uniqueSorted([
      ...users.filter(u => (u.role === 'buyer' || u.role === 'admin') && u.approved !== false).map(u => u.name),
      ...visibleOrders.map(buyerOf).filter(n => n !== '미지정'),
    ]),
    [users, visibleOrders],
  );
  const knownStores = useMemo(
    () => uniqueSorted([...visibleOrders.flatMap(t => [t.store, getBillingStore(t.store, rules)]), ...rules.flatMap(r => [r.groupName, r.storeName])]),
    [visibleOrders, rules],
  );

  // 화면에 먼저 반영하고 저장은 뒤에서 한다 (서버 응답을 기다리면 몇 초씩 걸려 보임). 저장에 실패하면 되돌린다.
  const saveFast = (prev: Transaction, next: Transaction) => {
    patchOrderLocal(next);
    run(saveOrders([next]).catch(e => { patchOrderLocal(prev); throw e; }));
  };
  const run = (p: Promise<unknown>) => p.catch(e => notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'));

  return (
    <Screen
      title={<><HandCoins className="h-5 w-5 text-emerald-400" />수금관리</>}
      subtitle="거래처(대표 기준)별 청구 · 입금 · 미수금을 날짜별로 정산합니다."
      onClose={() => nav.setView(null)}
      width="max-w-6xl"
      actions={
        <>
          <Button tone={editingOrder ? 'primary' : 'secondary'} onClick={() => setEditingOrder(v => !v)}>
            <ListOrdered className="h-4 w-4" />{editingOrder ? '순서 편집 끝' : '순서 편집'}
          </Button>
          {isAdmin(user) && <Button tone="violet" onClick={() => nav.open({ type: 'rules' })}><Layers className="h-4 w-4" />대표거래처 관리</Button>}
          <Button tone="success" onClick={() => setEntry({ store: storeQuery })}><Plus className="h-4 w-4" />수금 입력</Button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ['이월 미수금 (전날까지)', formatMoney(totals.carry), totals.carry !== 0 ? 'text-sky-300' : 'text-gray-500'],
          ['오늘 청구액', formatMoney(totals.billed), 'text-rose-400'],
          ['총 주문', `${totals.orders}건`, 'text-gray-100'],
          ['완료(사입비 부과)', `${totals.completed}건`, 'text-emerald-400'],
          ['미처리', `${totals.unprocessed}건`, 'text-amber-400'],
        ].map(([label, value, tone]) => (
          <div key={label} className={cx('rounded-xl border border-gray-800 bg-gray-900 p-2.5', label.startsWith('이월') && 'col-span-2 sm:col-span-1')}>
            <p className="text-[10px] font-semibold text-gray-400">{label}</p>
            <p className={cx('mt-0.5 font-mono text-base font-bold', tone)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2.5 rounded-2xl border border-gray-800 bg-gray-900 p-3 sm:grid-cols-[auto_1fr_auto_auto]">
        <Input type="date" value={nav.date} onChange={e => nav.setDate(e.target.value)} aria-label="기준 날짜" />
        <StoreSearch value={storeQuery} onChange={setStoreQuery} knownStores={knownStores} rules={rules} placeholder="상호/대표거래처 (초성)" />
        <Select value={buyer} onChange={e => setBuyer(e.target.value)} aria-label="사입삼촌">
          <option value="">전체 사입삼촌</option>
          {buyers.map(b => <option key={b} value={b}>{b}</option>)}
        </Select>
        <Select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} aria-label="상태">
          <option value="">전체 상태</option>
          <option value="미처리">미처리만 ({totals.unprocessed})</option>
          <option value="완료">완료만 ({totals.completed})</option>
          <option value="미수">미수 있음</option>
        </Select>
      </div>

      {editingOrder && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-700 bg-indigo-950/60 p-3 text-xs text-indigo-100">
          <span>거래처 오른쪽의 <b>⋮⋮ 손잡이를 꾹 눌렀다가</b>(0.3초) 원하는 위치로 끌어 놓으세요. <b>수금하러 도는 순서대로</b> 놓으면 바로 저장되고, 다른 기기에서도 같은 순서로 보입니다.</span>
          {savedOrder && savedOrder.length > 0 && <Button size="sm" onClick={() => saveOrder([])}>기본 순서로 되돌리기</Button>}
        </div>
      )}

      <StoreGroupTable
        reorder={{ editing: editingOrder, onDrop: dropStore }}
        groups={groups}
        mode="collection"
        onOpenOrder={t => nav.open({ type: 'order', tx: t })}
        onToggleFee={t => saveFast(t, toggleFeeCharged(t))}
        onWaiveFee={showFeeWaive ? (t, waived) => saveFast(t, setFeeWaived(t, waived)) : undefined}
        onEditDeposit={setEditDeposit}
        onDeleteDeposit={setDeleteDeposit}
        onCollect={g => setEntry({ store: g.store })}
      />

      {entry && <CollectionEntryModal initialStore={entry.store} date={nav.date} groups={allGroups} knownStores={knownStores} onClose={() => setEntry(null)} />}
      {editDeposit && <EditDepositModal t={editDeposit} onClose={() => setEditDeposit(null)} />}
      {deleteDeposit && (
        <ConfirmDialog
          title="수금 내역 삭제"
          message={`${deleteDeposit.store} · ${formatMoney(splitAmounts(deleteDeposit).paid)}\n이 입금/수금 기록을 삭제할까요?`}
          confirmLabel="삭제"
          onCancel={() => setDeleteDeposit(null)}
          onConfirm={() => {
            run(deleteOrder(deleteDeposit));
            setDeleteDeposit(null);
          }}
        />
      )}
    </Screen>
  );
}

function CollectionEntryModal({
  initialStore, date, groups, knownStores, onClose,
}: { initialStore: string; date: string; groups: StoreGroup[]; knownStores: string[]; onClose: () => void }) {
  const { user, rules, saveOrders, notify } = useApp();
  const [entryDate, setEntryDate] = useState(date);
  const [store, setStore] = useState(initialStore);
  const [deposit, setDeposit] = useState('');
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const group = groups.find(g => compact(g.store) === compact(getBillingStore(store, rules)));
  const balance = group?.balance ?? 0; // 음수면 이미 더 받은 상태
  const due = Math.max(0, balance); // 입력칸을 채울 때 쓰는 받을 금액
  const remaining = balance - (Number(deposit) || 0) - (Number(cash) || 0); // 음수면 초과 입금
  const manager = user?.name || user?.username || '관리자';
  const subs = store ? getSubStores(store, rules) : [];

  // 미수 상위 거래처 바로 선택
  const withBalance = groups.filter(g => g.balance > 0 && (!store || fuzzyIncludes(g.store, store))).slice(0, 8);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const depositAmount = Number(deposit) || 0;
    const cashAmount = Number(cash) || 0;
    if (!store.trim()) return notify('거래처를 입력해주세요.', 'error');
    if (depositAmount <= 0 && cashAmount <= 0) return notify('입금액 또는 수금액을 입력해주세요.', 'error');

    const make = (amount: number, label: string): Transaction => ({
      id: '',
      date: entryDate,
      store: store.trim(),
      market: DEPOSIT_MARKET,
      floor: '',
      room: '',
      manager: '',
      region: '',
      localManager: manager,
      expense: 0,
      income: amount,
      status: '완료',
      remark: label,
      createdAt: new Date().toISOString(),
    });
    const memo = note.trim();
    const list: Transaction[] = [];
    if (depositAmount > 0) list.push(make(depositAmount, `수금 (온라인입금${memo ? ` - ${memo}` : ''})`));
    if (cashAmount > 0) list.push(make(cashAmount, memo ? `수금 (${memo})` : '수금'));

    setSaving(true);
    try {
      await saveOrders(list);
      notify(`${store} 수금 ${formatMoney(depositAmount + cashAmount)}을 저장했습니다.`, 'success');
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="수금 입력" subtitle={`${entryDate} 기준`} icon={<HandCoins className="h-5 w-5 text-emerald-400" />} onClose={onClose}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="success" type="submit" form="collection-form" disabled={saving}>{saving ? '저장 중...' : '수금 저장'}</Button></>}
    >
      <form id="collection-form" onSubmit={submit} className="space-y-3.5">
        <div className="flex items-center justify-between rounded-xl border border-indigo-900 bg-indigo-950/50 p-3">
          <div>
            <p className="text-sm font-bold text-gray-100">{store || '거래처를 선택하세요'}</p>
            <p className="mt-0.5 text-[11px] text-indigo-300">
              미수금 잔액 {group && group.carry !== 0 && <Badge className="ml-1 bg-sky-900 text-sky-200">이월 {formatMoney(group.carry)} 포함</Badge>}
              {group && group.completedCount > 0 && <Badge className="ml-1 bg-emerald-900 text-emerald-200">완료 {group.completedCount}건</Badge>}
              {subs.length > 0 && <Badge className="ml-1 bg-violet-900 text-violet-200">종속 {subs.length}곳 포함</Badge>}
            </p>
          </div>
          <div className="text-right">
            <p className={cx('font-mono text-lg font-bold', balance < 0 ? 'text-sky-300' : 'text-rose-400')}>{formatMoney(balance)}</p>
            {balance < 0 && <p className="text-[11px] text-sky-300">초과 입금 (다음에 받을 때 빼 줍니다)</p>}
            {group && group.fee > 0 && <p className="text-[11px] text-indigo-300">사입비 {formatMoney(group.fee)} 포함</p>}
            {group?.isMonthly && <p className="text-[11px] text-emerald-400">월사입 - 사입비 제외</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="거래처 *">
            <StoreSearch value={store} onChange={setStore} knownStores={knownStores} rules={rules} placeholder="상호 (초성)" required />
          </Field>
          <Field label="날짜">
            <Input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
          </Field>
        </div>
        {withBalance.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {withBalance.map(g => (
              <button key={g.store} type="button" onClick={() => setStore(g.store)} className={cx('rounded-lg border px-2 py-1 text-[11px] font-bold', compact(g.store) === compact(store) ? 'border-emerald-500 bg-emerald-800 text-white' : 'border-gray-700 bg-gray-800 text-gray-300')}>
                {g.store} <span className="text-rose-300">{formatMoney(g.balance)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="온라인 입금액 (천원)">
            <MoneyInput value={deposit} onChange={v => {
              setDeposit(v);
              // 미수금에서 입금액을 뺀 나머지를 현금 수금칸에 미리 채워 준다
              if (v && due > 0) setCash(String(Math.max(0, due - (Number(v) || 0))));
              else if (!v) setCash('');
            }} placeholder={due > 0 ? String(due) : '0'} />
          </Field>
          <Field label="현금 수금액 (천원)">
            <MoneyInput value={cash} onChange={setCash} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => { setDeposit(String(due)); setCash('0'); }}>입금 전액</Button>
            <Button size="sm" onClick={() => { setCash(String(due)); setDeposit(''); }}>수금 전액</Button>
          </div>
          <p className="rounded-lg bg-gray-950 px-2 py-1 text-[11px] font-bold text-gray-300">
            처리 후 미수 <span className={cx('ml-1 font-mono text-sm', remaining > 0 ? 'text-amber-400' : remaining < 0 ? 'text-sky-300' : 'text-emerald-400')}>{formatMoney(remaining)}</span>
          </p>
        </div>

        <Field label="담당 (수금 등록자)">
          <Input value={manager} disabled />
        </Field>
        <Field label="메모">
          <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="수금 관련 메모" />
        </Field>
      </form>
    </Modal>
  );
}

function EditDepositModal({ t, onClose }: { t: Transaction; onClose: () => void }) {
  const { saveOrders, notify } = useApp();
  const [amount, setAmount] = useState(String(splitAmounts(t).paid));
  const save = async () => {
    try {
      await saveOrders([{ ...t, income: Number(amount) || 0, expense: 0 }]);
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    }
  };
  return (
    <Modal title="입금/수금액 수정" subtitle={`${t.store} · ${t.date}`} onClose={onClose} size="sm" z="z-[300]"
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" onClick={save}>수정하기</Button></>}
    >
      <MoneyInput value={amount} onChange={setAmount} autoFocus />
    </Modal>
  );
}
