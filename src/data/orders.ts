import { endAt, get, limitToLast, onValue, orderByKey, query, ref, remove, set, startAt, update } from 'firebase/database';
import type { Transaction } from '../types';
import { normalizeDate } from '../domain/dates';
import { parseAmount } from '../domain/format';
import { DEPOSIT_MARKET, RECEIVABLE_MARKET, normalizeMarket } from '../domain/markets';
import { IS_DEMO, rtdb, withTimeout, write } from './firebase';

/**
 * RTDB 저장 형식: orders/{YYYY-MM-DD}/{orderId}
 * 필드명은 기존 앱과 같은 DB를 공유하므로 바꾸지 않는다. (처리비고/사입비제외/사입비포함/구분 은 새로 추가된 선택 필드)
 */
export interface OrderRecord {
  날짜: string;
  상호: string;
  건물명: string;
  층: string;
  호수: string;
  담당: string;
  수량: number;
  반품여부: boolean;
  대납금: number;
  입금액: number;
  메모: string;
  완료여부: string;
  지역: string;
  처리비고?: string;
  사입비제외?: boolean;
  사입비포함?: boolean;
  구분?: 'receivable';
  localManager: string;
  actualManager: string;
  assignedManager: string;
  merchantId: string;
  merchantName: string;
  merchantStoreName: string;
  orderAt: string;
  updatedAt: string;
}

/** 실시간 동기화 범위: 최근 90일치 날짜 */
const SYNC_DAYS = 90;

export const newOrderId = () => `order_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
export const makeTxId = (date: string, orderId: string) => `firebase_${encodeURIComponent(date)}_${encodeURIComponent(orderId)}`;

export function decodeOrder(dateKey: string, orderId: string, o: Partial<OrderRecord>): Transaction | null {
  const store = String(o.상호 ?? '').trim();
  const payment = parseAmount(o.대납금);
  const income = parseAmount(o.입금액);
  if (!store && payment === 0 && income === 0) return null;

  const market = normalizeMarket(o.건물명 || '');
  const isDeposit = market === DEPOSIT_MARKET;
  const date = normalizeDate(o.날짜 || dateKey);
  const status = String(o.완료여부 ?? '').trim();
  return {
    id: makeTxId(dateKey, orderId),
    firebaseOrderId: orderId,
    firebaseDate: dateKey,
    date,
    store: String(o.상호 ?? ''),
    market,
    floor: String(o.층 ?? ''),
    room: String(o.호수 ?? ''),
    manager: String(o.담당 ?? ''),
    region: String(o.지역 ?? ''),
    // 입금 건은 대납금(-금액)과 입금액(+금액)이 함께 저장되므로 입금액이 있으면 그것만 쓴다 (이중 합산 방지)
    expense: isDeposit ? (income !== 0 ? 0 : -Math.abs(payment)) : payment,
    income,
    itemCount: Number(o.수량 ?? 0) || 0,
    isReturn: Boolean(o.반품여부),
    status: status === '미완료' ? '' : status,
    remark: String(o.메모 ?? ''),
    processingRemark: String(o.처리비고 ?? ''),
    isFeeExcluded: Boolean(o.사입비제외),
    isFeeIncluded: Boolean(o.사입비포함),
    recordType: market === RECEIVABLE_MARKET || o.구분 === 'receivable' ? 'receivable' : 'order',
    localManager: String(o.localManager ?? ''),
    actualManager: String(o.actualManager ?? ''),
    assignedManager: String(o.assignedManager ?? ''),
    merchantId: String(o.merchantId ?? ''),
    merchantName: String(o.merchantName ?? ''),
    merchantStoreName: String(o.merchantStoreName ?? ''),
    orderAt: o.orderAt || null,
  };
}

export function encodeOrder(t: Transaction): OrderRecord {
  const market = normalizeMarket(t.market || '');
  const isDeposit = market === DEPOSIT_MARKET;
  const record: OrderRecord = {
    날짜: normalizeDate(t.date),
    상호: String(t.store || ''),
    건물명: market,
    층: String(t.floor || ''),
    호수: String(t.room || ''),
    담당: String(t.manager || ''),
    수량: Number(t.itemCount ?? 0) || 0,
    반품여부: Boolean(t.isReturn),
    대납금: isDeposit ? -Math.abs(Number(t.income || t.expense || 0)) : Number(t.expense || 0),
    입금액: Number(t.income || 0),
    메모: String(t.remark || ''),
    완료여부: String(t.status || ''),
    지역: String(t.region || ''),
    localManager: String(t.localManager || ''),
    actualManager: String(t.actualManager || ''),
    assignedManager: String(t.assignedManager || ''),
    merchantId: String(t.merchantId || ''),
    merchantName: String(t.merchantName || ''),
    merchantStoreName: String(t.merchantStoreName || ''),
    orderAt: t.orderAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (t.processingRemark) record.처리비고 = t.processingRemark;
  if (t.isFeeExcluded) record.사입비제외 = true;
  if (t.isFeeIncluded) record.사입비포함 = true;
  if (t.recordType === 'receivable' && market !== RECEIVABLE_MARKET) record.구분 = 'receivable';
  return record;
}

export function subscribeOrders(onChange: (orders: Transaction[]) => void, onError?: (e: Error) => void) {
  if (IS_DEMO) return () => undefined;
  const recent = query(ref(rtdb, 'orders'), orderByKey(), limitToLast(SYNC_DAYS));
  return onValue(
    recent,
    snapshot => {
      const rows: Transaction[] = [];
      const data = (snapshot.val() || {}) as Record<string, Record<string, Partial<OrderRecord>>>;
      for (const [dateKey, day] of Object.entries(data)) {
        if (!day || typeof day !== 'object') continue;
        for (const [orderId, record] of Object.entries(day)) {
          if (!record) continue;
          const tx = decodeOrder(dateKey, orderId, record);
          if (tx) rows.push(tx);
        }
      }
      onChange(rows);
    },
    error => onError?.(error),
  );
}

/**
 * 저장 후 확정된 주문을 돌려준다 (새 주문이면 id 부여, 날짜가 바뀌면 이전 날짜 위치에서 삭제).
 */
type OrderUpdates = Record<string, unknown>;

/**
 * 저장할 쓰기 목록을 만든다.
 * previous(화면에 있던 직전 값)가 있고 날짜가 그대로면 바뀐 필드만 쓴다.
 * 여러 사람이 같은 주문을 동시에 고쳐도(예: 삼촌은 대납금, 관리자는 비고) 서로의 변경을 덮어쓰지 않게 하기 위함.
 */
export function prepareForSave(t: Transaction, previous?: Transaction): { tx: Transaction; updates: OrderUpdates } {
  const date = normalizeDate(t.date);
  if (!date) throw new Error('주문 날짜가 없습니다.');
  if (!String(t.store || '').trim() && !Number(t.expense) && !Number(t.income)) {
    throw new Error('빈 주문(상호 및 금액 없음)은 저장할 수 없습니다.');
  }
  const orderId = t.firebaseOrderId || newOrderId();
  const updates: OrderUpdates = {};
  const moved = !!(t.firebaseOrderId && t.firebaseDate && t.firebaseDate !== date);
  const record = encodeOrder({ ...t, date });

  if (moved) updates[`orders/${t.firebaseDate}/${orderId}`] = null;

  if (!moved && t.firebaseOrderId && previous && previous.firebaseOrderId === t.firebaseOrderId) {
    const before = encodeOrder({ ...previous, date: normalizeDate(previous.date), orderAt: previous.orderAt || record.orderAt }) as unknown as Record<string, unknown>;
    const after = record as unknown as Record<string, unknown>;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      k => k !== 'updatedAt' && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    for (const k of changed) updates[`orders/${date}/${orderId}/${k}`] = after[k] ?? null;
    if (changed.length > 0) updates[`orders/${date}/${orderId}/updatedAt`] = record.updatedAt;
  } else {
    updates[`orders/${date}/${orderId}`] = record;
  }

  const tx: Transaction = {
    ...t,
    date,
    market: normalizeMarket(t.market),
    id: makeTxId(date, orderId),
    firebaseOrderId: orderId,
    firebaseDate: date,
  };
  return { tx, updates };
}

export async function saveOrders(list: Transaction[], previous: Map<string, Transaction> = new Map()): Promise<Transaction[]> {
  const saved: Transaction[] = [];
  const updates: OrderUpdates = {};
  for (const t of list) {
    const prepared = prepareForSave(t, t.id ? previous.get(t.id) : undefined);
    saved.push(prepared.tx);
    Object.assign(updates, prepared.updates);
  }
  if (Object.keys(updates).length > 0) {
    if (!IS_DEMO) await write(update(ref(rtdb), updates), '주문 저장', 15000);
  }
  return saved;
}

export async function deleteOrder(t: Transaction): Promise<void> {
  const orderId = t.firebaseOrderId;
  const dateKey = t.firebaseDate || normalizeDate(t.date);
  if (!orderId || !dateKey || IS_DEMO) return;
  await write(remove(ref(rtdb, `orders/${dateKey}/${orderId}`)), '주문 삭제');
}

/**
 * DB 전체 주문 (중복 정리 · 백업용). 동기화 범위(90일)보다 오래된 것도 포함.
 * 상호·금액이 모두 빈 레코드는 orders 에서 빼고 empties 로 따로 돌려준다.
 */
type EmptyRef = Pick<Transaction, 'firebaseOrderId' | 'firebaseDate' | 'date'>;

/** 날짜 키 목록만 가볍게 받는다 (REST shallow). 규칙상 막히면 null */
async function fetchDateKeys(): Promise<string[] | null> {
  try {
    const res = await withTimeout(fetch(`${rtdb.app.options.databaseURL}/orders.json?shallow=true`), 30000, '날짜 목록 조회');
    if (!res.ok) return null;
    return Object.keys((await res.json()) || {}).sort();
  } catch {
    return null;
  }
}

function collect(data: Record<string, Record<string, Partial<OrderRecord>>>, orders: Transaction[], empties: EmptyRef[]) {
  for (const [dateKey, day] of Object.entries(data || {})) {
    for (const [orderId, record] of Object.entries(day || {})) {
      const tx = record ? decodeOrder(dateKey, orderId, record) : null;
      if (tx) orders.push(tx);
      else empties.push({ firebaseOrderId: orderId, firebaseDate: dateKey, date: dateKey });
    }
  }
}

/**
 * 서버 전체 주문. 데이터가 커서 한 번에 받으면 시간 초과가 나므로 달마다 나눠 받는다.
 * onProgress(받은 달 수, 전체 달 수)로 진행 상황을 알린다.
 */
export async function fetchAllOrders(onProgress?: (done: number, total: number) => void): Promise<{ orders: Transaction[]; empties: EmptyRef[] }> {
  if (IS_DEMO) throw new Error('미리보기에서는 서버 데이터를 불러올 수 없습니다.');
  const orders: Transaction[] = [];
  const empties: EmptyRef[] = [];

  const keys = await fetchDateKeys();
  if (!keys) {
    // 날짜 목록을 못 받으면 예전처럼 한 번에 받되 넉넉히 기다린다
    const snapshot = await withTimeout(get(ref(rtdb, 'orders')), 180000, '전체 주문 조회');
    collect(snapshot.val(), orders, empties);
    return { orders, empties };
  }

  const months = [...new Set(keys.map(k => k.slice(0, 7)))];
  for (let i = 0; i < months.length; i++) {
    onProgress?.(i, months.length);
    const m = months[i];
    const snapshot = await withTimeout(get(query(ref(rtdb, 'orders'), orderByKey(), startAt(m), endAt(`${m}\uf8ff`))), 90000, `${m} 주문 조회`);
    collect(snapshot.val(), orders, empties);
  }
  onProgress?.(months.length, months.length);
  return { orders, empties };
}

/** 빈 레코드까지 포함해 지정한 주문들을 한 번에 삭제 */
export async function deleteOrders(list: Pick<Transaction, 'firebaseOrderId' | 'firebaseDate' | 'date'>[]): Promise<void> {
  const updates: Record<string, null> = {};
  for (const t of list) {
    const dateKey = t.firebaseDate || normalizeDate(t.date);
    if (t.firebaseOrderId && dateKey) updates[`orders/${dateKey}/${t.firebaseOrderId}`] = null;
  }
  if (Object.keys(updates).length > 0 && !IS_DEMO) await write(update(ref(rtdb), updates), '주문 삭제', 20000);
}

export async function deleteAllOrders(): Promise<void> {
  if (IS_DEMO) return;
  await set(ref(rtdb, 'orders'), null);
}
