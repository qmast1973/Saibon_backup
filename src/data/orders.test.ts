import { describe, expect, it, vi } from 'vitest';

// Firebase 연결 없이 저장 형식만 검사한다
vi.mock('./firebase', () => ({ rtdb: {}, withTimeout: (p: Promise<unknown>) => p }));
vi.mock('firebase/database', () => ({}));

const { decodeOrder, encodeOrder, prepareForSave } = await import('./orders');

describe('RTDB 주문 저장 형식', () => {
  it('기존 앱과 같은 한글 필드명으로 저장하고 다시 읽는다', () => {
    const record = encodeOrder({
      id: '', date: '2026-10-01', store: '상호A', market: '청평', floor: '3', room: '12호', manager: '삼촌', region: '합성동',
      expense: 15, income: 0, itemCount: 2, status: '주문찾기', remark: '바지', processingRemark: '내일 재방문', isFeeExcluded: true,
    });
    expect(record).toMatchObject({ 날짜: '2026-10-01', 상호: '상호A', 건물명: '청평화', 층: '3', 호수: '12호', 대납금: 15, 수량: 2, 완료여부: '주문찾기', 메모: '바지', 처리비고: '내일 재방문', 사입비제외: true });
    expect(record).not.toHaveProperty('사입비포함');

    const back = decodeOrder('2026-10-01', 'order_1', record)!;
    expect(back).toMatchObject({ id: 'firebase_2026-10-01_order_1', store: '상호A', market: '청평화', expense: 15, processingRemark: '내일 재방문', isFeeExcluded: true, isFeeIncluded: false });
  });

  it('입금 건은 대납금 음수 + 입금액으로 저장하고, 읽을 때 이중 합산하지 않는다', () => {
    const record = encodeOrder({ id: '', date: '2026-10-01', store: '상호A', market: '입금', floor: '', room: '', manager: '', region: '', expense: 0, income: 20 });
    expect(record.대납금).toBe(-20);
    expect(record.입금액).toBe(20);
    const back = decodeOrder('2026-10-01', 'x', record)!;
    expect(back.expense).toBe(0);
    expect(back.income).toBe(20);
  });

  it('예전 형식 금액 문자열과 미완료 표기를 읽는다', () => {
    const back = decodeOrder('2026-10-01', 'x', { 상호: '상호A', 건물명: 'APM', 대납금: '15,000원' as unknown as number, 완료여부: '미완료' })!;
    expect(back.expense).toBe(15);
    expect(back.status).toBe('');
  });

  it('빈 레코드는 무시', () => {
    expect(decodeOrder('2026-10-01', 'x', { 상호: '', 대납금: 0, 입금액: 0 })).toBeNull();
  });

  it('날짜를 바꾸면 이전 날짜 위치를 지운다', () => {
    const { tx, updates } = prepareForSave({
      id: 'firebase_2026-10-01_o1', firebaseOrderId: 'o1', firebaseDate: '2026-10-01', date: '2026-10-02',
      store: '상호A', market: 'APM', floor: '1', room: '2호', manager: '', region: '', expense: 0, income: 0,
    });
    expect(updates['orders/2026-10-01/o1']).toBeNull();
    expect(updates['orders/2026-10-02/o1']).toBeTruthy();
    expect(tx.id).toBe('firebase_2026-10-02_o1');
  });
});
