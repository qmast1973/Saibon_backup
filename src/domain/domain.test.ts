import { describe, expect, it } from 'vitest';
import type { GroupRule, Transaction, User } from '../types';
import { normalizeDate, getBusinessDate, isOrderTimeBlocked } from './dates';
import { formatMoney, formatRoom, parseAmount } from './format';
import { belongsToMerchant, getBillingStore, getMerchantBundle, getSubStores, matchesTransaction } from './groups';
import { applyStatus, dedupeTransactions, duplicateKey, findDuplicateOrders, isFeeCharged, splitAmounts, toggleFeeCharged } from './ledger';
import { matchMarketToken, normalizeMarket } from './markets';
import { composeRoomWithWholesale, parseOrderText } from './orderParser';
import { buildStoreGroups } from './storeGroups';
import { fuzzyIncludes, initials } from './text';
import { filterVisible } from './access';
import { hangulToQwerty } from './keyboard';

const tx = (o: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), date: '2026-10-01', store: '상호A', market: '디오트', floor: '3', room: '12호',
  manager: '', region: '', expense: 0, income: 0, status: '', ...o,
});

describe('건물명 정규화', () => {
  it('은어 · 약어 · 초성을 정식 명칭으로 바꾼다', () => {
    expect(normalizeMarket('청평')).toBe('청평화');
    expect(normalizeMarket('제평')).toBe('제일평화');
    expect(normalizeMarket('럭스')).toBe('APM럭스');
    expect(normalizeMarket('ㅊㅍㅎ')).toBe('청평화');
    expect(normalizeMarket('apm')).toBe('APM');
    expect(normalizeMarket('입금')).toBe('입금');
  });
  it("'디'/'d' 는 호수로 디오트/디자이너를 가른다", () => {
    expect(normalizeMarket('디', 'f10')).toBe('디오트');
    expect(normalizeMarket('d', '가-10')).toBe('디오트');
    expect(normalizeMarket('디', '1-10')).toBe('디자이너');
    expect(normalizeMarket('D', '15호')).toBe('디자이너');
    expect(normalizeMarket('디')).toBe('디오트');
  });
  it('한 글자 약어는 일반 단어 안에서 건물로 오인하지 않는다', () => {
    expect(matchMarketToken('요청')).toBeNull();
    expect(matchMarketToken('신청')).toBeNull();
    expect(matchMarketToken('CPH(청평화)')?.canonical).toBe('청평화');
  });
});

describe('주문 텍스트 파서', () => {
  it('첫 줄 상호 + 자연어 + 슬래시 형식', () => {
    const rows = parseOrderText('구름상회\n디 3-12 바지 2장\n청 B1-5 스커트\n블루문/디오트/3층/12호');
    expect(rows.map(r => [r.retailStore, r.wholesaleStore, r.market, r.floor, r.room, r.remark])).toEqual([
      ['구름상회', '바지', '디자이너', '3층', '12호', '2장'],
      ['구름상회', '스커트', '청평화', '지하1층', '5호', ''],
      ['구름상회', '블루문', '디오트', '3층', '12호', ''],
    ]);
  });
  it('신상마켓 요청서', () => {
    const text = [
      '📩 신상마켓 사입 요청서 도착',
      '예시상호으로부터 사입 요청서가 도착했습니다.',
      '1개중 1번째 주문서입니다.',
      '📍주문내용 : 1. APM / 1층 28 / 레이크(LAKE) / 대납',
      '2. CPH(청평화) / 지하1층 라23 / 제이런 / 대납',
      '☎️ 관련해서 문의사항은 카카오채널로 연락 부탁드려요',
    ].join('\n');
    const rows = parseOrderText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ retailStore: '예시상호', market: 'APM', floor: '1층', room: '28호', wholesaleStore: '레이크(LAKE)', remark: '대납' });
    expect(rows[1]).toMatchObject({ market: '청평화', floor: '지하1층', room: '라23', wholesaleStore: '제이런' });
  });
  it('주문이 아닌 짧은 줄은 윗 주문 비고로 붙인다', () => {
    const rows = parseOrderText('상호E\nAPM 7F 45 상호B 단가 15000\n샘플건');
    expect(rows).toHaveLength(1);
    expect(rows[0].remark).toBe('단가 15000 / 샘플건');
  });
  it('도매처를 호수 뒤 괄호로 붙인다', () => {
    expect(composeRoomWithWholesale('28호', '레이크(LAKE)')).toBe('28호 (레이크(LAKE))');
    expect(composeRoomWithWholesale('12', '(상호B)')).toBe('12호 (상호B)');
    expect(composeRoomWithWholesale('f10', '상호 미지정')).toBe('f10호');
  });
});

describe('표시 형식', () => {
  it('호수', () => {
    expect(formatRoom('25')).toBe('25호');
    expect(formatRoom('12 (어반)')).toBe('12호 (어반)');
    expect(formatRoom('(어반)호')).toBe('(어반)');
    expect(formatRoom('어반')).toBe('(어반)');
  });
  it('금액은 천원 단위', () => {
    expect(formatMoney(15)).toBe('15,000원');
    expect(formatMoney(0)).toBe('0원');
    expect(parseAmount('1,500')).toBe(1500);
    expect(parseAmount('-3')).toBe(-3);
  });
  it('날짜', () => {
    expect(normalizeDate('2024.5.12')).toBe('2024-05-12');
    expect(normalizeDate('24/05/12')).toBe('2024-05-12');
    expect(normalizeDate('20240512')).toBe('2024-05-12');
    expect(normalizeDate(45424)).toBe('2024-05-12');
    expect(getBusinessDate(new Date(2026, 9, 2, 3))).toBe('2026-10-01');
    expect(getBusinessDate(new Date(2026, 9, 2, 8))).toBe('2026-10-02');
    expect(isOrderTimeBlocked(new Date(2026, 9, 2, 3))).toBe(true);
    expect(isOrderTimeBlocked(new Date(2026, 9, 2, 1))).toBe(false);
  });
  it('초성 검색은 검색어가 초성일 때만', () => {
    expect(initials('대표상호')).toBe('ㄷㅍㅅㅎ');
    expect(fuzzyIncludes('대표 상호', 'ㄷㅍㅅ')).toBe(true);
    expect(fuzzyIncludes('대표상호', '표상')).toBe(true);
    expect(fuzzyIncludes('선희', '상호')).toBe(false);
  });
  it('한글 자판으로 친 아이디', () => {
    expect(hangulToQwerty('ㅁ으ㅑㅜ')).toBe('admin');
  });
});

const rules: GroupRule[] = [
  { id: '1', storeName: '상호A-1', groupName: '대표A', matchType: 'exact', effectiveFrom: '' },
  { id: '2', storeName: '지점', groupName: '대표B', matchType: 'prefix', effectiveFrom: '', isMonthlyPurchase: true, monthlyPurchaseAmount: 300000 },
];

describe('대표거래처', () => {
  it('종속 상호를 대표로 묶는다', () => {
    expect(getBillingStore('상호A-1', rules)).toBe('대표A');
    expect(getBillingStore('대표A', rules)).toBe('대표A');
    expect(getBillingStore('지점3호', rules)).toBe('대표B');
    expect(getBillingStore('기타', rules)).toBe('기타');
    expect(getSubStores('대표A', rules)).toEqual(['상호A-1']);
  });
  it('대표명으로 검색하면 종속 주문도 나온다', () => {
    expect(matchesTransaction(tx({ store: '상호A-1' }), '대표A', rules)).toBe(true);
    expect(matchesTransaction(tx({ store: '상호A-1' }), 'ㄷㅍ', rules)).toBe(true);
    expect(matchesTransaction(tx({ store: '기타' }), '대표A', rules)).toBe(false);
  });
  it('상인은 자기 묶음 주문만 본다', () => {
    const merchant: User = { username: 'm', name: 'm', role: 'merchant', approved: true, storeName: '대표A' };
    expect(belongsToMerchant(tx({ store: '상호A-1' }), merchant, rules)).toBe(true);
    expect(belongsToMerchant(tx({ store: '기타' }), merchant, rules)).toBe(false);
    expect(getMerchantBundle(merchant, rules, [])).toEqual(['대표A', '상호A-1']);
  });
});

describe('정산', () => {
  it('입금 행은 받은 돈', () => {
    expect(splitAmounts({ expense: 30, income: 0 })).toEqual({ billed: 30, paid: 0 });
    expect(splitAmounts({ expense: -20, income: 0 })).toEqual({ billed: 0, paid: 20 });
    expect(splitAmounts({ expense: 0, income: 20 })).toEqual({ billed: 0, paid: 20 });
  });
  it('사입비 부과 전환은 처리 상태를 건드리지 않는다', () => {
    const t = tx({ status: '주문찾기' });
    expect(isFeeCharged(t)).toBe(true);
    const off = toggleFeeCharged(t);
    expect(off.status).toBe('주문찾기');
    expect(isFeeCharged(off)).toBe(false);
    expect(isFeeCharged(toggleFeeCharged(off))).toBe(true);
  });
  it('대표 거래처별 청구 · 사입비 · 미수금', () => {
    const rows = [
      tx({ store: '대표A', expense: 35, status: '주문찾기' }),
      tx({ store: '상호A-1', expense: 12 }),
      tx({ store: '대표A', market: '입금', income: 20 }),
      tx({ store: '지점1', expense: 10, status: '샘플' }),
    ];
    const groups = buildStoreGroups(rows, { mode: 'collection', rules, users: [], includeFee: true });
    const a = groups.find(g => g.store === '대표A')!;
    expect(a).toMatchObject({ orderCount: 2, completedCount: 1, billed: 47, paid: 20, fee: 4, balance: 31 });
    const b = groups.find(g => g.store === '대표B')!;
    expect(b).toMatchObject({ isMonthly: true, fee: 0, balance: 10 });
    const noFee = buildStoreGroups(rows, { mode: 'collection', rules, users: [], includeFee: false });
    expect(noFee.find(g => g.store === '대표A')!.balance).toBe(27);
  });
  it('상태 변경 시 물건 갯수 · 반품 기본값', () => {
    expect(applyStatus(tx({}), '주문찾기', '삼촌')).toMatchObject({ status: '주문찾기', itemCount: 1, actualManager: '삼촌' });
    expect(applyStatus(tx({ itemCount: 3 }), '교환/매입', '삼촌')).toMatchObject({ itemCount: 1, isReturn: true });
    expect(applyStatus(tx({ status: '샘플' }), '샘플', '삼촌').status).toBe('');
    expect(applyStatus(tx({}), '주문없음', '삼촌').itemCount).toBe(0);
  });
});

describe('중복', () => {
  it('같은 날 · 상호 · 매장 주문을 찾는다 (층이 한쪽만 있으면 층 무시)', () => {
    const existing = [tx({ store: '상호 A', market: '디오트', floor: '', room: '12' })];
    const { duplicates, fresh } = findDuplicateOrders([tx({ store: '상호A', floor: '3', room: '12호' }), tx({ room: '13호' })], existing);
    expect(duplicates).toHaveLength(1);
    expect(fresh).toHaveLength(1);
  });
  it('정보가 많은 쪽을 남긴다', () => {
    const a = tx({ id: 'a' });
    const b = tx({ id: 'b', remark: '바지' });
    const { kept, removed } = dedupeTransactions([a, b, tx({ id: 'e', store: '' })]);
    expect(kept.map(t => t.id)).toEqual(['b']);
    expect(removed.map(t => t.id).sort()).toEqual(['a', 'e']);
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });
});

describe('역할별 조회', () => {
  const orders = [tx({ market: '디오트', store: '상호A' }), tx({ market: 'APM', store: '상호B', merchantId: 'm2' })];
  it('사입삼촌은 담당 건물만', () => {
    const buyer: User = { username: 'b', name: 'b', role: 'buyer', approved: true, allowedMarkets: ['디오'] };
    expect(filterVisible(orders, buyer, [], []).map(t => t.market)).toEqual(['디오트']);
  });
  it('지방삼촌은 담당 상인만', () => {
    const local: User = { username: 'l', name: 'l', role: 'local', approved: true, assignedMerchants: ['m1'] };
    const users: User[] = [{ username: 'm1', name: 'x', role: 'merchant', approved: true, storeName: '상호A' }];
    expect(filterVisible(orders, local, users, []).map(t => t.store)).toEqual(['상호A']);
  });
});
