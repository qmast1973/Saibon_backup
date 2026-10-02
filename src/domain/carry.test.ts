import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { buildStoreGroups, computeCarryOver } from './storeGroups';

const base = { floor: '1', room: '1호', manager: '', region: '합성동' };
let n = 0;
const order = (date: string, store: string, expense: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ id: `o${n++}`, date, store, market: 'APM', ...base, expense, income: 0, status: '', ...extra });
const deposit = (date: string, store: string, amount: number): Transaction =>
  ({ id: `d${n++}`, date, store, market: '입금', ...base, expense: 0, income: amount, status: '완료' });

const opts = { rules: [], users: [], includeFee: true };

describe('이월 미수금', () => {
  it('전날 못 받은 금액(대납 + 사입비 - 입금)이 다음 날로 넘어온다', () => {
    const rows = [
      order('2026-10-01', '상호A', 30, { status: '주문찾기' }), // 완료 → 사입비 4
      deposit('2026-10-01', '상호A', 20),
    ];
    const carry = computeCarryOver(rows, '2026-10-02', opts);
    expect(carry.get('상호A')?.amount).toBe(14); // 30 + 4 - 20
  });

  it('기준 날짜 당일과 이후 기록은 이월에 넣지 않는다', () => {
    const rows = [order('2026-10-02', '상호A', 30), order('2026-10-03', '상호A', 50)];
    expect(computeCarryOver(rows, '2026-10-02', opts).size).toBe(0);
  });

  it('여러 날 쌓인 미수를 합치고, 중간에 낸 입금을 뺀다', () => {
    const rows = [
      order('2026-09-29', '상호A', 10),
      order('2026-09-30', '상호A', 20),
      deposit('2026-09-30', '상호A', 5),
    ];
    expect(computeCarryOver(rows, '2026-10-02', opts).get('상호A')?.amount).toBe(25);
  });

  it('딱 맞게 다 받은 거래처는 넘어오지 않는다', () => {
    const rows = [order('2026-10-01', '상호A', 10), deposit('2026-10-01', '상호A', 10)];
    expect(computeCarryOver(rows, '2026-10-02', opts).size).toBe(0);
  });

  it('더 받은 거래처는 음수(-)로 넘어온다', () => {
    const rows = [order('2026-10-01', '상호B', 10), deposit('2026-10-01', '상호B', 30)];
    expect(computeCarryOver(rows, '2026-10-02', opts).get('상호B')?.amount).toBe(-20);
  });

  it('초과 입금하면 미수금이 음수(-)로 표시되고, 다음 청구에서 빠진다', () => {
    const group = buildStoreGroups([order('2026-10-02', '상호A', 10), deposit('2026-10-02', '상호A', 25)], { mode: 'collection', ...opts });
    expect(group[0].balance).toBe(-15);

    const carry = computeCarryOver([order('2026-10-01', '상호A', 10), deposit('2026-10-01', '상호A', 25)], '2026-10-02', opts);
    const next = buildStoreGroups([order('2026-10-02', '상호A', 20)], { mode: 'collection', ...opts, carry });
    expect(next[0]).toMatchObject({ carry: -15, balance: 5 });
  });

  it('대표거래처로 묶인 상호는 한 거래처로 합산한다', () => {
    const rules = [{ id: 'g1', storeName: '상호A-1', groupName: '대표A', matchType: 'exact' as const, effectiveFrom: '' }];
    const rows = [order('2026-10-01', '상호A-1', 10), order('2026-10-01', '대표A', 5)];
    expect(computeCarryOver(rows, '2026-10-02', { ...opts, rules }).get('대표A')?.amount).toBe(15);
  });

  it('미수금 기록(receivable)은 이중으로 잡히지 않도록 넣지 않는다', () => {
    const rows = [order('2026-10-01', '상호A', 10), order('2026-10-01', '상호A', 99, { market: '미수금', recordType: 'receivable' })];
    expect(computeCarryOver(rows, '2026-10-02', opts).get('상호A')?.amount).toBe(10);
  });

  it('오늘 주문이 없어도 이월이 있으면 한 줄로 나오고, 오늘 입금이 이월에서 빠진다', () => {
    const carry = computeCarryOver([order('2026-10-01', '상호A', 30)], '2026-10-02', opts);
    const noOrderToday = buildStoreGroups([], { mode: 'collection', ...opts, carry });
    expect(noOrderToday).toHaveLength(1);
    expect(noOrderToday[0]).toMatchObject({ store: '상호A', carry: 30, balance: 30, orderCount: 0, region: '합성동' });

    const paidToday = buildStoreGroups([deposit('2026-10-02', '상호A', 12)], { mode: 'collection', ...opts, carry });
    expect(paidToday[0]).toMatchObject({ carry: 30, paid: 12, balance: 18 });
  });

  it('월사입 거래처는 이월에도 사입비가 붙지 않는다', () => {
    const users = [{ username: 'm1', name: '대표', role: 'merchant' as const, approved: true, storeName: '상호M', isMonthlyPurchase: true }];
    const rows = [order('2026-10-01', '상호M', 10, { status: '주문찾기' })];
    expect(computeCarryOver(rows, '2026-10-02', { ...opts, users }).get('상호M')?.amount).toBe(10);
  });

  it('묶인 거래처는 어느 한 곳에 입금해도 대표거래처 합계에서 빠진다 (초과 입금 포함)', () => {
    const rules = [
      { id: 'g1', storeName: '상호A-1', groupName: '대표A', matchType: 'exact' as const, effectiveFrom: '' },
      { id: 'g2', storeName: '상호A-2', groupName: '대표A', matchType: 'exact' as const, effectiveFrom: '' },
    ];
    const o = { ...opts, rules };
    const today = [order('2026-10-02', '상호A-1', 10), order('2026-10-02', '상호A-2', 20), deposit('2026-10-02', '상호A-1', 40)];
    const groups = buildStoreGroups(today, { mode: 'collection', ...o });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ store: '대표A', billed: 30, paid: 40, balance: -10 });

    // 다음 날로도 대표거래처 하나의 음수 이월로 넘어간다
    const carry = computeCarryOver(today, '2026-10-03', o);
    expect([...carry.keys()]).toEqual(['대표A']);
    expect(carry.get('대표A')?.amount).toBe(-10);
  });
});
