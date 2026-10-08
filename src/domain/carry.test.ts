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

import { defaultItemCount } from './ledger';
describe('상태 기준 갯수 (사장님 규칙)', () => {
  it('1이 되는 상태는 0이면 1, 이미 입력한 숫자는 유지', () => {
    expect(defaultItemCount('주문찾기', 0)).toBe(1);
    expect(defaultItemCount('주문찾기', undefined)).toBe(1);
    expect(defaultItemCount('주문찾기', 2)).toBe(2);
  });
  it('0이 되는 상태는 0, 교환/매입은 1', () => {
    expect(defaultItemCount('올미송(결제만)', 3)).toBe(0);
    expect(defaultItemCount('교환/매입', 0)).toBe(1);
  });
});

import { STAT_FILTERS, totalItemCount } from './ledger';
describe('갯수 집계 숫자 검산', () => {
  const list = [
    order('2026-10-02', '상호A', 10, { status: '주문찾기', itemCount: 2 }),
    order('2026-10-02', '상호A', 0, { status: '올미송(결제만)', itemCount: 0 }),
    order('2026-10-02', '상호B', 0, { status: '미송(찾기)', itemCount: 1 }),
    order('2026-10-02', '상호B', 0, { status: '', itemCount: 5 }), // 미처리인데 갯수만 먼저 입력된 주문
    deposit('2026-10-02', '상호A', 7),
  ];
  const orders = list.filter(t => t.market !== '입금');
  const count = (key: string) => orders.filter(STAT_FILTERS.find(s => s.key === key)!.test).length;

  it('완료 = 갯수 있음 + 갯수 없음, 총 = 완료 + 미처리', () => {
    expect(count('completed')).toBe(count('hasItems') + count('noItems'));
    expect(orders.length).toBe(count('completed') + count('uncompleted'));
    expect([count('hasItems'), count('noItems'), count('uncompleted')]).toEqual([2, 1, 1]);
  });

  it('카드의 물건 갯수 합계와 표(거래처별 합계)의 갯수 합계가 같다 (미처리 주문의 갯수는 세지 않는다)', () => {
    const groups = buildStoreGroups(list, { mode: 'stats', ...opts });
    const tableTotal = groups.reduce((n, g) => n + g.itemCount, 0);
    expect(totalItemCount(orders)).toBe(3);
    expect(tableTotal).toBe(3);
  });
});

import { applyStoreOrder, moveToIndex } from './storeGroups';
describe('거래처 순서 직접 정하기', () => {
  const g = (...names: string[]) => names.map(store => ({ store }));
  const names = (list: { store: string }[]) => list.map(x => x.store);

  it('저장한 순서대로 정렬하고, 순서에 없는 거래처는 기본 순서로 뒤에 붙는다', () => {
    expect(names(applyStoreOrder(g('가', '나', '다', '라'), ['다', '가']))).toEqual(['다', '가', '나', '라']);
    expect(names(applyStoreOrder(g('가', '나'), undefined))).toEqual(['가', '나']);
    expect(names(applyStoreOrder(g('가', '나'), []))).toEqual(['가', '나']);
  });

  it('끌어서 놓은 자리(옮긴 뒤 위치)로 옮긴 순서를 돌려준다 (처음 옮길 때는 보이는 순서가 저장 순서가 된다)', () => {
    expect(moveToIndex(undefined, ['가', '나', '다'], '다', 0)).toEqual(['다', '가', '나']);
    expect(moveToIndex(undefined, ['가', '나', '다'], '가', 2)).toEqual(['나', '다', '가']);
    expect(moveToIndex(undefined, ['가', '나', '다'], '가', 1)).toEqual(['나', '가', '다']);
  });

  it('제자리에 놓거나 범위를 벗어나도 안전하다', () => {
    expect(moveToIndex(['가', '나'], ['가', '나'], '가', 0)).toEqual(['가', '나']);
    expect(moveToIndex(['가', '나'], ['가', '나'], '나', 99)).toEqual(['가', '나']);
    expect(moveToIndex(undefined, ['가'], '가', 0)).toEqual(['가']);
  });

  it('걸러져서 안 보이는 거래처의 자리는 유지한다', () => {
    // 전체 순서: 가 숨김1 나 숨김2 다  /  화면에는 가 나 다만 보임 → 다를 가 바로 뒤(1번째)로
    const saved = ['가', '숨김1', '나', '숨김2', '다'];
    const moved = moveToIndex(saved, ['가', '나', '다'], '다', 1);
    expect(moved).toEqual(['가', '다', '숨김1', '나', '숨김2']);
    expect(names(applyStoreOrder(g('가', '나', '다'), moved))).toEqual(['가', '다', '나']);
  });
});

import { cleanRegion } from './storeGroups';
describe('수금 목록의 지역 칸', () => {
  const buildings = new Set(['APM', '디오트', '청평화']);

  it('합성동 · 창원 같은 지역은 그대로 두고, 비었거나 미지정이면 빈 값', () => {
    expect(cleanRegion('합성동', buildings)).toBe('합성동');
    expect(cleanRegion('창원', buildings)).toBe('창원');
    expect(cleanRegion('', buildings)).toBe('');
    expect(cleanRegion(undefined, buildings)).toBe('');
    expect(cleanRegion('미지정', buildings)).toBe('');
  });

  it('서울 건물 이름(별칭 포함)이 지역에 들어가 있으면 빈 값', () => {
    expect(cleanRegion('APM', buildings)).toBe('');
    expect(cleanRegion('청평', buildings)).toBe(''); // 별칭 → 청평화
    expect(cleanRegion('디오트', buildings)).toBe('');
  });

  it('거래처 줄의 지역은 건물 이름을 건너뛰고 첫 진짜 지역을 쓴다. 없으면 빈 값', () => {
    const rows = [
      order('2026-10-02', '상호A', 10, { region: 'APM', market: 'APM' }),
      order('2026-10-02', '상호A', 10, { region: '창원', market: '청평화' }),
      order('2026-10-02', '상호B', 10, { region: '디오트', market: '디오트' }),
      order('2026-10-02', '상호C', 10, { region: '' }),
    ];
    const groups = buildStoreGroups(rows, { mode: 'collection', ...opts });
    expect(groups.map(g => [g.store, g.region])).toEqual([['상호A', '창원'], ['상호B', ''], ['상호C', '']]); // 지역 있는 줄이 먼저
  });
});

describe('사입비 제외(서비스)', () => {
  it('제외한 주문은 사입비만 빠지고 대납금은 그대로 청구되며 이월에도 반영된다', () => {
    const rows = [
      order('2026-10-01', '상호A', 30, { status: '주문찾기' }),
      order('2026-10-01', '상호A', 10, { status: '반품만', isFeeExcluded: true }),
    ];
    const [g] = buildStoreGroups(rows, { ...opts, mode: 'collection' });
    expect(g.fee).toBe(4); // 완료 1건만 사입비
    expect(g.balance).toBe(44); // 30 + 10 + 4
    expect(g.completedCount).toBe(1);
    expect(g.unprocessedCount).toBe(0);
    expect(computeCarryOver(rows, '2026-10-02', opts).get('상호A')?.amount).toBe(44);
  });
});
