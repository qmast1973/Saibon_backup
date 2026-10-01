import type { Transaction } from '../types';
import { normalizeDate } from './dates';
import { floorKey, formatRoom } from './format';
import { DEPOSIT_MARKET, RECEIVABLE_MARKET, normalizeMarket } from './markets';
import { compact } from './text';

/** 완료된 주문 1건당 사입비 (천원) */
export const FEE_PER_ORDER = 4;

/**
 * 청구액(대납)과 받은 돈(입금)을 분리한다.
 * 입금 행은 대납금이 음수로 저장되어 있을 수 있어 둘 다 받은 돈으로 본다.
 */
export function splitAmounts(t: Pick<Transaction, 'expense' | 'income'>): { billed: number; paid: number } {
  const expense = Number(t.expense) || 0;
  const income = Number(t.income) || 0;
  return {
    billed: expense > 0 ? expense : 0,
    paid: (expense < 0 ? -expense : 0) + (income > 0 ? income : 0),
  };
}

export const isReceivable = (t: Transaction) => t.recordType === 'receivable' || normalizeMarket(t.market) === RECEIVABLE_MARKET;
export const isDeposit = (t: Transaction) => normalizeMarket(t.market) === DEPOSIT_MARKET;
export const isOrder = (t: Transaction) => !isDeposit(t) && !isReceivable(t);
export const hasStatus = (t: Transaction) => String(t.status || '').trim() !== '';

/** 수금 화면의 사입비 부과 대상인지 (상태가 있으면 완료, 수동 전환 플래그가 우선) */
export function isFeeCharged(t: Transaction): boolean {
  return (hasStatus(t) && !t.isFeeExcluded) || !!t.isFeeIncluded;
}

/** 사입비 부과 여부를 뒤집은 주문 */
export function toggleFeeCharged(t: Transaction): Transaction {
  const charged = isFeeCharged(t);
  return { ...t, isFeeExcluded: charged, isFeeIncluded: !charged };
}

/**
 * 같은 주문인지 판별하는 키.
 * 주문: 날짜+상호+건물+층+호수 / 입금·미수금: 날짜+상호+금액+비고
 */
export function duplicateKey(t: Transaction): string {
  const date = normalizeDate(t.date);
  const store = compact(t.store);
  const market = normalizeMarket(t.market, t.room);
  if (market === DEPOSIT_MARKET || market === RECEIVABLE_MARKET || t.recordType === 'receivable') {
    return `deposit|${date}|${store}|${Number(t.expense || 0)}|${Number(t.income || 0)}|${String(t.remark || '').trim()}`;
  }
  return `order|${date}|${store}|${market}|${floorKey(t.floor)}|${formatRoom(t.room)}`;
}

/**
 * 새로 입력하는 주문 중 이미 같은 날·같은 상호·같은 매장에 등록된 것을 찾는다.
 * 층이 한쪽에만 적혀 있으면 층은 비교하지 않는다.
 */
export function findDuplicateOrders<T extends Transaction>(incoming: T[], existing: Transaction[]): { duplicates: T[]; fresh: T[] } {
  const index = new Map<string, Transaction[]>();
  for (const t of existing) {
    if (!isOrder(t)) continue;
    const k = `${normalizeDate(t.date)}|${compact(t.store)}|${normalizeMarket(t.market, t.room)}|${formatRoom(t.room)}`;
    const list = index.get(k);
    if (list) list.push(t);
    else index.set(k, [t]);
  }
  const duplicates: T[] = [];
  const fresh: T[] = [];
  for (const t of incoming) {
    const k = `${normalizeDate(t.date)}|${compact(t.store)}|${normalizeMarket(t.market, t.room)}|${formatRoom(t.room)}`;
    const floor = floorKey(t.floor);
    const hit = (index.get(k) || []).some(e => !floor || !floorKey(e.floor) || floorKey(e.floor) === floor);
    (hit ? duplicates : fresh).push(t);
  }
  return { duplicates, fresh };
}

/** 같은 키의 중복 중 정보(비고·금액)가 더 많은 쪽을 남긴다. */
export function dedupeTransactions(list: Transaction[]): { kept: Transaction[]; removed: Transaction[] } {
  const best = new Map<string, Transaction>();
  const removed: Transaction[] = [];
  const richness = (t: Transaction) => (String(t.remark || '').trim() ? 1 : 0) + (Number(t.expense) || Number(t.income) ? 1 : 0);
  for (const t of list) {
    if (!compact(t.store) && !Number(t.expense) && !Number(t.income)) {
      removed.push(t);
      continue;
    }
    const k = duplicateKey(t);
    const prev = best.get(k);
    if (!prev) best.set(k, t);
    else if (richness(t) > richness(prev)) {
      removed.push(prev);
      best.set(k, t);
    } else removed.push(t);
  }
  return { kept: [...best.values()], removed };
}

// ---------------------------------------------------------------------------
// 사입삼촌 처리 상태
// ---------------------------------------------------------------------------

export type StatusGroup = 'done' | 'pending' | 'return';

/** 주문처리 화면의 3개 버튼과 각각의 세부 상태 */
export const STATUS_BUTTONS: { group: StatusGroup; label: string; options: string[] }[] = [
  { group: 'done', label: '완료처리', options: ['주문찾기', '샘플', '주문없음', '물건없음'] },
  { group: 'pending', label: '미송', options: ['올미송(결제만)', '미송(찾기)'] },
  { group: 'return', label: '반품', options: ['교환', '반품만', '반송', '교환/매입', '매입처리'] },
];

const DONE = new Set(['완료', '주문찾기', '매입처리', '주고옴', '샘플', '주문없음', '물건없음', '수금완료']);
const PENDING = new Set(['미송', '올미송(결제만)', '미송(찾기)', '찾기']);
export const RETURN_STATUSES = new Set(['반품', '반품/교환', '반품만', '교환', '반송', '교환매입', '교환 매입', '교환/매입']);
export const EXCHANGE_PURCHASE = new Set(['교환/매입', '교환매입', '교환 매입']);

export function statusGroup(status: string | undefined): StatusGroup | null {
  const s = String(status || '').trim();
  if (!s) return null;
  if (DONE.has(s)) return 'done';
  if (PENDING.has(s)) return 'pending';
  if (RETURN_STATUSES.has(s)) return 'return';
  return 'done';
}

/**
 * 상태를 바꿀 때 물건 갯수 / 반품 여부 기본값 규칙.
 * 같은 상태를 다시 누르면 처리 대기('')로 되돌린다.
 */
export function applyStatus(t: Transaction, nextStatus: string, managerName: string): Transaction {
  const status = t.status === nextStatus ? '' : nextStatus;
  let itemCount = Number(t.itemCount ?? 0) || 0;
  if (EXCHANGE_PURCHASE.has(status)) itemCount = 1;
  else if (['주문찾기', '샘플', '미송(찾기)', '교환', '반송', '완료', '반품/교환'].includes(status) && itemCount === 0) itemCount = 1;

  const isReturn = RETURN_STATUSES.has(status) ? true : t.isReturn;
  return {
    ...t,
    status,
    itemCount,
    isReturn,
    actualManager: managerName || t.actualManager || t.manager,
    assignedManager: managerName || t.assignedManager || t.manager,
  };
}

/** 집계 화면 상태 필터 */
export const STAT_FILTERS: { key: string; label: string; unit: string; tone: string; test: (t: Transaction) => boolean }[] = [
  { key: 'all', label: '총 주문건수', unit: '건', tone: 'slate', test: () => true },
  { key: 'completed', label: '완료건수', unit: '건', tone: 'emerald', test: t => hasStatus(t) },
  { key: 'uncompleted', label: '처리 대기', unit: '건', tone: 'amber', test: t => !hasStatus(t) },
  { key: 'gte2', label: '물건 2개이상', unit: '건', tone: 'indigo', test: t => (Number(t.itemCount) || 0) >= 2 },
  { key: 'none', label: '주문/물건 없음', unit: '건', tone: 'slate', test: t => ['주문없음', '물건없음'].includes(String(t.status || '').trim()) },
  { key: 'allMisong', label: '올미송(결제)', unit: '건', tone: 'yellow', test: t => t.status === '올미송(결제만)' },
  { key: 'misongFind', label: '미송(찾기)', unit: '건', tone: 'orange', test: t => t.status === '미송(찾기)' },
  { key: 'returnOnly', label: '반품만', unit: '건', tone: 'rose', test: t => t.status === '반품만' },
  { key: 'exchange', label: '교환/반송', unit: '건', tone: 'pink', test: t => ['교환', '반품/교환', '반송'].includes(String(t.status || '').trim()) },
  { key: 'exchangePurchase', label: '교환/매입', unit: '건', tone: 'fuchsia', test: t => EXCHANGE_PURCHASE.has(String(t.status || '').trim()) },
  { key: 'purchase', label: '매입처리', unit: '건', tone: 'purple', test: t => t.status === '매입처리' },
];

/** 물건 갯수 합계: 처리된 주문의 입력 갯수를 그대로 더한다 */
export function totalItemCount(list: Transaction[]): number {
  return list.reduce((sum, t) => sum + (hasStatus(t) ? Number(t.itemCount) || 0 : 0), 0);
}
