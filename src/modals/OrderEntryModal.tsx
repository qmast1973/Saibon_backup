import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Transaction } from '../types';
import type { Nav } from '../App';
import { normalizeDate } from '../domain/dates';
import { formatFloor, formatRoom } from '../domain/format';
import { getMerchantBundle } from '../domain/groups';
import { findDuplicateOrders } from '../domain/ledger';
import { MARKET_SEPARATOR_RE, NON_BUILDING_MARKETS, normalizeMarket } from '../domain/markets';
import { compact, uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Button, ConfirmDialog, Field, Input, Modal, StoreSearch, Textarea } from '../components/ui';
import { MarketInput } from '../components/MarketInput';

interface Row {
  market: string;
  floor: string;
  room: string;
}
const emptyRow = (): Row => ({ market: '', floor: '', room: '' });

/** 건물 입력 후보: 사입삼촌(일반)은 담당 건물만 */
export function useMarketOptions(): string[] {
  const { user, markets } = useApp();
  return useMemo(() => {
    if (user?.role === 'buyer' && !user.isBuyerAdmin) return (user.allowedMarkets || []).map(m => normalizeMarket(m));
    return markets.filter(m => m && !NON_BUILDING_MARKETS.has(m.trim()));
  }, [user, markets]);
}

export function OrderEntryModal({ editing, nav, onClose }: { editing?: Transaction; nav: Nav; onClose: () => void }) {
  const { user, visibleOrders, rules, orders, saveOrders, notify } = useApp();
  const marketOptions = useMarketOptions();
  const isEdit = !!editing;
  const isMerchant = user?.role === 'merchant';
  const isRegularBuyer = user?.role === 'buyer' && !user.isBuyerAdmin;
  const locked = isRegularBuyer && isEdit; // 일반 사입삼촌은 주문 위치/날짜를 고칠 수 없다

  const bundle = useMemo(
    () => (isMerchant && user ? getMerchantBundle(user, rules, uniqueSorted(orders.map(o => o.store))) : []),
    [isMerchant, user, rules, orders],
  );
  const stores = useMemo(() => uniqueSorted(visibleOrders.map(t => t.store)), [visibleOrders]);

  const [date, setDate] = useState(editing?.date || nav.date);
  const [store, setStore] = useState(editing?.store || (isMerchant ? user?.storeName || '' : ''));
  const [remark, setRemark] = useState(editing?.remark || '');
  const [rows, setRows] = useState<Row[]>(
    editing ? [{ market: editing.market, floor: editing.floor, room: editing.room }] : [emptyRow(), emptyRow(), emptyRow(), emptyRow()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<{ dupes: Transaction[]; fresh: Transaction[]; all: Transaction[] } | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const filledRows = rows.filter(r => r.market.trim() || r.floor.trim() || r.room.trim());

  const setRow = (i: number, patch: Partial<Row>) => setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const buildOrders = (): Transaction[] =>
    filledRows.map(r => {
      const base: Transaction = editing ?? {
        id: '',
        date,
        store,
        market: '',
        floor: '',
        room: '',
        manager: '',
        region: '',
        expense: 0,
        income: 0,
        status: '',
        orderAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      return {
        ...base,
        date: normalizeDate(date),
        store: store.trim(),
        market: normalizeMarket(r.market, r.room),
        floor: r.floor.trim(),
        room: formatRoom(r.room),
        remark: remark.trim(),
        merchantId: base.merchantId || (isMerchant ? user!.username : ''),
        merchantName: base.merchantName || (isMerchant ? user!.name : ''),
        merchantStoreName: base.merchantStoreName || (isMerchant ? user!.storeName || '' : ''),
      };
    });

  const persist = async (list: Transaction[]) => {
    setSaving(true);
    try {
      await saveOrders(list);
      notify(isEdit ? '주문을 수정했습니다.' : `주문 ${list.length}건을 저장했습니다.`, 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다. 네트워크를 확인해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!date || !store.trim()) return setError('날짜와 상호를 입력해주세요.');
    if (filledRows.length === 0) return setError('주문(건물명, 층, 호수)을 1건 이상 입력해주세요.');
    if (filledRows.some(r => !r.market.trim() || !r.floor.trim() || !r.room.trim())) return setError('건물명, 층, 호수를 모두 입력해주세요.');
    if (filledRows.some(r => MARKET_SEPARATOR_RE.test(r.market.trim()))) return setError('올바른 건물명을 입력해주세요.');

    const list = buildOrders();
    if (!isEdit) {
      const { duplicates: dupes, fresh } = findDuplicateOrders(list, visibleOrders);
      if (dupes.length > 0) return setDuplicates({ dupes, fresh, all: list });
    }
    persist(list);
  };

  return (
    <Modal
      big
      title={isEdit ? '사입 주문 수정' : '신규 사입 주문'}
      icon={<Plus className="h-5 w-5 text-indigo-400" />}
      onClose={onClose}
      footer={
        <>
          {!isEdit && (
            <Button tone="ghost" onClick={() => { onClose(); nav.open({ type: 'quick' }); }} className="mr-auto">
              <Sparkles className="h-4 w-4 text-yellow-300" />빠른주문(붙여넣기)
            </Button>
          )}
          {isEdit && user?.role === 'buyer' && (
            <Button tone="success" onClick={() => setConfirmComplete(true)} className="mr-auto"><Check className="h-4 w-4" />완료 처리</Button>
          )}
          <Button onClick={onClose}>취소</Button>
          <Button tone="primary" type="submit" form="order-form" disabled={saving}>{saving ? '저장 중...' : '저장하기'}</Button>
        </>
      }
    >
      <form id="order-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="날짜 *">
            <Input type="date" required value={date} disabled={locked} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="상호 (소매점) *">
            {isMerchant && bundle.length > 1 ? (
              <select value={store} onChange={e => setStore(e.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm font-bold">
                {bundle.map(s => <option key={s} value={s}>{s}{compact(s) === compact(user?.storeName) ? ' (대표)' : ''}</option>)}
              </select>
            ) : locked || (isMerchant && !!user?.storeName) ? (
              <Input value={store} disabled />
            ) : (
              <StoreSearch value={store} onChange={setStore} knownStores={stores} rules={rules} placeholder="상호 검색" required />
            )}
          </Field>
        </div>

        <div>
          <div className="mb-1.5 hidden grid-cols-[1.4fr_.7fr_.7fr_28px] gap-2 text-[11px] font-bold text-gray-400 sm:grid">
            <span>건물명 *</span><span>층 *</span><span>호수 *</span><span />
          </div>
          <div className="space-y-4 sm:space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2 sm:grid-cols-[1.4fr_.7fr_.7fr_28px]">
                <MarketInput
                  className="col-span-3 sm:col-span-1"
                  options={marketOptions}
                  value={r.market}
                  disabled={locked}
                  placeholder="건물명 *"
                  onChange={v => setRow(i, { market: v })}
                  onBlur={e => setRow(i, { market: normalizeMarket(e.target.value, r.room) })}
                />
                <Input value={r.floor} disabled={locked} placeholder="층 *" onChange={e => setRow(i, { floor: e.target.value })} />
                <Input
                  value={r.room}
                  disabled={locked}
                  placeholder="호수 *"
                  onChange={e => setRow(i, { room: e.target.value })}
                  onBlur={e => r.market && setRow(i, { market: normalizeMarket(r.market, e.target.value) })}
                />
                {!isEdit && rows.length > 1 ? (
                  <button type="button" onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-500 hover:text-rose-400" aria-label="줄 삭제">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
          {!isEdit && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => setRows(prev => [...prev, emptyRow()])}><Plus className="h-3.5 w-3.5" />줄 추가</Button>
            </div>
          )}
        </div>

        {filledRows.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-[11px]">
            <p className="mb-1 flex justify-between font-bold text-gray-300"><span>입력된 주문</span><span className="text-indigo-300">{filledRows.length}건</span></p>
            <ol className="max-h-28 space-y-0.5 overflow-y-auto text-gray-400">
              {filledRows.map((r, i) => (
                <li key={i}>{i + 1}. <b className="text-gray-200">{normalizeMarket(r.market, r.room) || '-'}</b> {formatFloor(r.floor)} {formatRoom(r.room)}</li>
              ))}
            </ol>
          </div>
        )}

        <Field label="비고 (주문 내용)">
          <Textarea value={remark} onChange={e => setRemark(e.target.value)} placeholder="품목, 수량, 요청사항" />
        </Field>
        {error && <p className="flex items-center gap-1.5 rounded-xl border border-rose-800 bg-rose-950/60 p-2.5 text-xs font-bold text-rose-200"><AlertCircle className="h-4 w-4" />{error}</p>}
      </form>

      {duplicates && (
        <DuplicateDialog
          date={date}
          labels={duplicates.dupes.map(t => `${t.store} · ${t.market} ${formatFloor(t.floor)} ${formatRoom(t.room)}`)}
          freshCount={duplicates.fresh.length}
          allCount={duplicates.all.length}
          onOnlyFresh={() => { setDuplicates(null); persist(duplicates.fresh); }}
          onAll={() => { setDuplicates(null); persist(duplicates.all); }}
          onCancel={() => setDuplicates(null)}
        />
      )}
      {confirmComplete && editing && (
        <ConfirmDialog
          title="완료 처리"
          message="이 주문을 완료(주문찾기) 처리할까요?"
          tone="success"
          confirmLabel="완료 처리"
          onCancel={() => setConfirmComplete(false)}
          onConfirm={() => persist([{ ...editing, status: '주문찾기', actualManager: user?.name || editing.actualManager }])}
        />
      )}
    </Modal>
  );
}

/** 같은 날 · 같은 상호 · 같은 매장 주문이 이미 있을 때 */
export function DuplicateDialog({
  date, labels, freshCount, allCount, onOnlyFresh, onAll, onCancel,
}: {
  date: string;
  labels: string[];
  freshCount: number;
  allCount: number;
  onOnlyFresh: () => void;
  onAll: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={`중복 주문 ${labels.length}건`} icon={<AlertCircle className="h-5 w-5 text-rose-400" />} onClose={onCancel} size="sm" z="z-[400]">
      <p className="mb-3 text-sm text-gray-300">{date}에 같은 상호 · 같은 매장 주문이 이미 있습니다.</p>
      <ul className="mb-4 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-3 text-xs text-rose-300">
        {labels.map((l, i) => <li key={i}>• {l}</li>)}
      </ul>
      <div className="flex flex-col gap-2">
        {freshCount > 0 && <Button tone="success" onClick={onOnlyFresh}><Check className="h-4 w-4" />중복 빼고 새 주문만 등록 ({freshCount}건)</Button>}
        <Button tone="warning" onClick={onAll}>중복 포함 모두 등록 ({allCount}건)</Button>
        <Button onClick={onCancel}>취소하고 다시 확인</Button>
      </div>
    </Modal>
  );
}
