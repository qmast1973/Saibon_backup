import type { GroupRule, Transaction, User } from '../types';
import { getBillingStore, getMonthlyPurchase } from './groups';
import { FEE_PER_ORDER, hasStatus, isFeeCharged, isOrder, splitAmounts } from './ledger';
import { sortKo } from './text';

/** 대표 거래처 단위로 묶은 한 줄 (수금관리 · 갯수 집계 공용) */
export interface StoreGroup {
  store: string; // 대표 거래처명
  region: string;
  manager: string;
  rows: Transaction[];
  orderCount: number;
  completedCount: number;
  unprocessedCount: number;
  billed: number; // 대납 합계
  paid: number; // 입금 합계
  fee: number; // 사입비
  balance: number; // 미수금 = 대납 + 사입비 - 입금
  itemCount: number;
  isMonthly: boolean;
  monthlyAmount: number;
}

export type GroupMode = 'collection' | 'stats';

/**
 * 수금관리: 완료(사입비 부과) 여부는 isFeeCharged 기준, 대납 0 원 + 입금 0 원인 주문도 건수에 포함.
 * 갯수 집계: 사입삼촌 처리 상태(hasStatus) 기준.
 */
export function buildStoreGroups(
  rows: Transaction[],
  opts: { mode: GroupMode; rules: GroupRule[]; users: User[]; includeFee: boolean },
): StoreGroup[] {
  const map = new Map<string, StoreGroup>();
  for (const t of rows) {
    const key = getBillingStore(String(t.store || '미지정').trim() || '미지정', opts.rules);
    let g = map.get(key);
    if (!g) {
      const monthly = getMonthlyPurchase(key, opts.rules, opts.users);
      g = {
        store: key,
        region: String(t.region || '').trim() || '미지정',
        manager: opts.mode === 'collection'
          ? String(t.localManager || t.manager || '').trim() || '미지정'
          : t.actualManager || t.assignedManager || t.manager || '미배정',
        rows: [],
        orderCount: 0, completedCount: 0, unprocessedCount: 0,
        billed: 0, paid: 0, fee: 0, balance: 0, itemCount: 0,
        isMonthly: monthly.isMonthly,
        monthlyAmount: monthly.amount,
      };
      map.set(key, g);
    }
    g.rows.push(t);
    g.itemCount += Number(t.itemCount) || 0;

    const { billed, paid } = opts.mode === 'collection' ? splitAmounts(t) : { billed: Number(t.expense) || 0, paid: Number(t.income) || 0 };
    g.billed += billed;
    g.paid += paid;

    if (!isOrder(t)) continue;
    if (opts.mode === 'collection' && !(billed > 0 || (billed === 0 && paid === 0))) continue;
    g.orderCount++;
    const done = opts.mode === 'collection' ? isFeeCharged(t) : hasStatus(t);
    if (done) g.completedCount++;
    else g.unprocessedCount++;
  }

  for (const g of map.values()) {
    g.fee = opts.mode === 'collection' && opts.includeFee && !g.isMonthly ? g.completedCount * FEE_PER_ORDER : 0;
    g.balance = Math.max(0, g.billed + g.fee - g.paid);
  }
  return [...map.values()].sort((a, b) => (opts.mode === 'collection' ? sortKo(a.region, b.region) : 0) || sortKo(a.store, b.store));
}
