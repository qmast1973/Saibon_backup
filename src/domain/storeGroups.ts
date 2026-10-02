import type { GroupRule, Transaction, User } from '../types';
import { getBillingStore, getMonthlyPurchase } from './groups';
import { DEFAULT_MARKETS, normalizeMarket } from './markets';
import { FEE_PER_ORDER, hasStatus, isFeeCharged, isOrder, isReceivable, splitAmounts } from './ledger';
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
  carry: number; // 이월 미수금 (이전 날짜에서 못 받은 금액)
  balance: number; // 미수금 = 이월 + 대납 + 사입비 - 입금 (초과 입금이면 음수)
  itemCount: number;
  isMonthly: boolean;
  monthlyAmount: number;
}

export type GroupMode = 'collection' | 'stats';

/** 건물 이름으로 쓰이는 값들 (기본 건물 목록 + 설정의 건물 목록 + 주문에 적힌 건물명) */
function buildingSet(rows: Transaction[], markets?: string[]): Set<string> {
  return new Set([...DEFAULT_MARKETS, ...(markets || []), ...rows.map(t => t.market || '')].filter(Boolean).map(m => normalizeMarket(m)));
}

/** 주문 한 건의 지역 표시값 (건물 이름이 들어 있으면 빈 값). 목록 줄마다 쓰는 가벼운 버전. */
export const regionLabel = (t: Pick<Transaction, 'region' | 'market'>, markets?: string[]) => cleanRegion(t.region, buildingSet([t as Transaction], markets));

/**
 * 지역 칸에 보여 줄 값. 합성동 · 창원 같은 지역만 남기고, 비어 있거나 '미지정', 또는 건물 이름(서울 상가)이 들어가 있으면 빈 값으로 둔다.
 */
export function cleanRegion(region: string | undefined, buildings: Set<string>): string {
  const r = String(region || '').trim();
  if (!r || r === '미지정') return '';
  return buildings.has(normalizeMarket(r)) ? '' : r;
}

/** 거래처(대표 기준)별 이월 미수금과, 그 거래처의 가장 최근 지역 · 담당 */
export type CarryOver = Map<string, { amount: number; region: string; manager: string }>;

/**
 * 수금관리: 완료(사입비 부과) 여부는 isFeeCharged 기준, 대납 0 원 + 입금 0 원인 주문도 건수에 포함.
 * 갯수 집계: 사입삼촌 처리 상태(hasStatus) 기준.
 */
export function buildStoreGroups(
  rows: Transaction[],
  opts: { mode: GroupMode; rules: GroupRule[]; users: User[]; includeFee: boolean; carry?: CarryOver; markets?: string[] },
): StoreGroup[] {
  const map = new Map<string, StoreGroup>();
  const buildings = buildingSet(rows, opts.markets);
  for (const t of rows) {
    const key = getBillingStore(String(t.store || '미지정').trim() || '미지정', opts.rules);
    let g = map.get(key);
    if (!g) {
      const monthly = getMonthlyPurchase(key, opts.rules, opts.users);
      g = {
        store: key,
        region: '',
        manager: opts.mode === 'collection'
          ? String(t.localManager || t.manager || '').trim() || '미지정'
          : t.actualManager || t.assignedManager || t.manager || '미배정',
        rows: [],
        orderCount: 0, completedCount: 0, unprocessedCount: 0,
        billed: 0, paid: 0, fee: 0, carry: 0, balance: 0, itemCount: 0,
        isMonthly: monthly.isMonthly,
        monthlyAmount: monthly.amount,
      };
      map.set(key, g);
    }
    g.rows.push(t);
    if (!g.region) g.region = cleanRegion(t.region, buildings);
    // 물건 갯수는 처리된 주문만 센다 (카드의 갯수 합계와 같은 기준이어야 표와 카드가 맞는다)
    if (isOrder(t) && hasStatus(t)) g.itemCount += Number(t.itemCount) || 0;

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

  // 오늘 주문이 없어도 이월 미수금이 있는 거래처는 한 줄로 보여 준다
  for (const [key, info] of opts.carry || []) {
    if (map.has(key)) continue;
    const monthly = getMonthlyPurchase(key, opts.rules, opts.users);
    map.set(key, {
      store: key, region: info.region, manager: info.manager, rows: [],
      orderCount: 0, completedCount: 0, unprocessedCount: 0,
      billed: 0, paid: 0, fee: 0, carry: 0, balance: 0, itemCount: 0,
      isMonthly: monthly.isMonthly, monthlyAmount: monthly.amount,
    });
  }

  for (const g of map.values()) {
    g.carry = opts.carry?.get(g.store)?.amount ?? 0;
    g.fee = opts.mode === 'collection' && opts.includeFee && !g.isMonthly ? g.completedCount * FEE_PER_ORDER : 0;
    g.balance = g.carry + g.billed + g.fee - g.paid; // 더 받았으면 음수(-)
  }
  return [...map.values()].sort((a, b) => (opts.mode === 'collection' ? Number(!a.region) - Number(!b.region) || sortKo(a.region, b.region) : 0) || sortKo(a.store, b.store));
}

/**
 * 기준 날짜 전까지 거래처별로 못 받은 금액(이월 미수금).
 * 날짜마다 (대납 + 사입비 - 입금)을 거래처별로 누적한다. 더 받은 거래처는 음수(-)로 넘어오고, 딱 맞게 받아 0이면 뺀다.
 * 미수금 기록(recordType receivable)은 합산하지 않는다: 이미 주문 금액에 들어 있어 이중으로 잡히기 때문.
 */
export function computeCarryOver(
  rows: Transaction[],
  beforeDate: string,
  opts: { rules: GroupRule[]; users: User[]; includeFee: boolean; markets?: string[] },
): CarryOver {
  const byDate = new Map<string, Transaction[]>();
  for (const t of rows) {
    if (!t.date || t.date >= beforeDate || isReceivable(t)) continue;
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }

  const total = new Map<string, { amount: number; region: string; manager: string; date: string }>();
  for (const [date, list] of byDate) {
    for (const g of buildStoreGroups(list, { mode: 'collection', ...opts })) {
      const prev = total.get(g.store);
      const net = g.billed + g.fee - g.paid;
      total.set(g.store, {
        amount: (prev?.amount ?? 0) + net,
        // 가장 최근 날짜의 지역 · 담당을 쓴다
        region: !prev || date >= prev.date ? g.region : prev.region,
        manager: !prev || date >= prev.date ? g.manager : prev.manager,
        date: !prev || date >= prev.date ? date : prev.date,
      });
    }
  }

  const out: CarryOver = new Map();
  for (const [store, v] of total) if (v.amount !== 0) out.set(store, { amount: v.amount, region: v.region, manager: v.manager });
  return out;
}

/** 저장해 둔 거래처 순서대로 정렬한다. 순서에 없는 거래처는 기본 순서 그대로 뒤에 붙는다. */
export function applyStoreOrder<T extends { store: string }>(groups: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return groups;
  const rank = new Map(order.map((name, i) => [name, i] as const));
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (rank.get(a.g.store) ?? Infinity) - (rank.get(b.g.store) ?? Infinity) || a.i - b.i)
    .map(x => x.g);
}

/**
 * 화면에 보이는 거래처 목록(shown)에서 name 을 toIndex 번째 자리(옮긴 뒤 위치)로 옮긴 전체 순서를 돌려준다.
 * 걸러져서 안 보이는 거래처의 순서는 그대로 두고, 저장된 순서에 없는 거래처는 보이는 순서대로 뒤에 붙인다.
 */
export function moveToIndex(saved: string[] | undefined, shown: string[], name: string, toIndex: number): string[] {
  const others = shown.filter(n => n !== name);
  const full = [...(saved || [])];
  for (const n of shown) if (!full.includes(n)) full.push(n);
  if (!shown.includes(name) || others.length === 0) return full;
  const rest = full.filter(n => n !== name);
  const clamped = Math.max(0, Math.min(toIndex, others.length));
  if (clamped === 0) rest.splice(rest.indexOf(others[0]), 0, name);
  else rest.splice(rest.indexOf(others[clamped - 1]) + 1, 0, name);
  return rest;
}
