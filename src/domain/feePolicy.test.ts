import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { cleanFeePolicy, feeOnAt, withFeeFrom } from './feePolicy';
import { buildStoreGroups, computeCarryOver } from './storeGroups';

describe('사입비 적용 시작일', () => {
  it('기록이 없으면 항상 받는다', () => {
    expect(feeOnAt([], '2026-10-01')).toBe(true);
  });
  it('끈 날짜부터만 받지 않고, 이전 날짜는 그대로 받는다', () => {
    const p = withFeeFrom([], '2026-10-09', false);
    expect(feeOnAt(p, '2026-10-08')).toBe(true);
    expect(feeOnAt(p, '2026-10-09')).toBe(false);
    expect(feeOnAt(p, '2026-12-31')).toBe(false);
  });
  it('다시 켜면 그날부터 다시 받는다', () => {
    const p = withFeeFrom(withFeeFrom([], '2026-10-09', false), '2026-10-20', true);
    expect(feeOnAt(p, '2026-10-15')).toBe(false);
    expect(feeOnAt(p, '2026-10-20')).toBe(true);
  });
  it('같은 날 다시 바꾸면 덮어쓰고, 의미 없는 기록은 남기지 않는다', () => {
    expect(withFeeFrom(withFeeFrom([], '2026-10-09', false), '2026-10-09', true)).toEqual([]);
    expect(withFeeFrom([], '2026-10-09', true)).toEqual([]);
  });
  it('서버 값 정리: 날짜순, 잘못된 항목 제외', () => {
    expect(cleanFeePolicy([{ from: '2026-10-09', on: false }, { from: 'x', on: true }, null, { from: '2026-10-01', on: true }])).toEqual([
      { from: '2026-10-01', on: true },
      { from: '2026-10-09', on: false },
    ]);
  });
});

describe('사입비를 끈 뒤에도 지난 날짜 계산은 그대로', () => {
  const base = { floor: '1', room: '1호', manager: '', region: '합성동' };
  let n = 0;
  const order = (date: string, store: string, expense: number): Transaction =>
    ({ id: `f${n++}`, date, store, market: 'APM', ...base, expense, income: 0, status: '주문찾기' });
  const deposit = (date: string, store: string, amount: number): Transaction =>
    ({ id: `fd${n++}`, date, store, market: '입금', ...base, expense: 0, income: amount, status: '완료' });

  it('사입비 받던 날 전액 수금한 거래처는 끈 뒤에도 초과 입금이 되지 않는다', () => {
    const rows = [order('2026-10-08', '상호A', 30), deposit('2026-10-08', '상호A', 34)]; // 30 + 사입비 4 = 34 전액 수금
    const policy = withFeeFrom([], '2026-10-09', false);
    const carry = computeCarryOver(rows, '2026-10-10', { rules: [], users: [], includeFee: d => feeOnAt(policy, d) });
    expect(carry.get('상호A')).toBeUndefined(); // 0 이라 이월 없음 (소급하면 -4 초과 입금이 됨)
    const retro = computeCarryOver(rows, '2026-10-10', { rules: [], users: [], includeFee: false });
    expect(retro.get('상호A')?.amount).toBe(-4);
  });
  it('끈 날부터의 주문에는 사입비가 붙지 않는다', () => {
    const rows = [order('2026-10-09', '상호A', 30)];
    const g = buildStoreGroups(rows, { mode: 'collection', rules: [], users: [], includeFee: feeOnAt(withFeeFrom([], '2026-10-09', false), '2026-10-09') });
    expect(g[0].fee).toBe(0);
    expect(g[0].balance).toBe(30);
  });
});
