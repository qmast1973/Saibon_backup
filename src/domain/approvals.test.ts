import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { approvalUpdates, desiredApprovals } from './approvals';

const u = (o: Partial<User>): User => ({ username: 'x', name: 'x', role: 'merchant', approved: false, ...o });

describe('승인 명단', () => {
  it('승인된 회원만 명단에 넣고, 관리자 · 서브관리자는 관리자 명단에도 넣는다', () => {
    const w = desiredApprovals([
      u({ uid: 'A', role: 'admin', approved: true }),
      u({ uid: 'B', role: 'buyer', isBuyerAdmin: true, approved: true }),
      u({ uid: 'C', role: 'merchant', approved: true }),
      u({ uid: 'D', role: 'merchant', approved: false }),
      u({ uid: 'E', role: 'admin', approved: false }), // 승인 전에 스스로 admin 이라고 적은 기록
      u({ role: 'merchant', approved: true }), // uid 없음
    ]);
    expect(w.approved.sort()).toEqual(['A', 'B', 'C']);
    expect(w.admins.sort()).toEqual(['A', 'B']);
  });
  it('차이만 업데이트로 만들고, 관리하는 본인은 지우지 않는다', () => {
    const upd = approvalUpdates(
      { approved: ['A', 'OLD'], admins: ['A'] },
      { approved: ['A', 'C'], admins: [] },
      'A',
    );
    expect(upd).toEqual({ 'approvedUids/C': true, 'approvedUids/OLD': null });
  });
  it('이미 같으면 아무것도 쓰지 않는다', () => {
    expect(approvalUpdates({ approved: ['A'], admins: ['A'] }, { approved: ['A'], admins: ['A'] }, 'A')).toEqual({});
  });
});

import { isRelevantForBuyer } from './access';
describe('새 주문 알림 대상', () => {
  const order = { id: 'o', date: '2026-10-11', store: 'A', market: '디오트', floor: '1', room: '1호', manager: '', region: '', expense: 0, income: 0 } as never;
  it('사입삼촌 · 서브관리자는 자기 담당 건물만, 관리자는 알림 대상이 아니다', () => {
    expect(isRelevantForBuyer(order, { username: 'a', name: 'a', role: 'admin', approved: true })).toBe(false);
    expect(isRelevantForBuyer(order, { username: 'b', name: 'b', role: 'buyer', approved: true, allowedMarkets: ['APM'] })).toBe(false);
    expect(isRelevantForBuyer(order, { username: 'b', name: 'b', role: 'buyer', approved: true, allowedMarkets: ['디오트'] })).toBe(true);
    expect(isRelevantForBuyer(order, { username: 'c', name: 'c', role: 'buyer', approved: true, isBuyerAdmin: true })).toBe(false); // 서브관리자도 담당이 아니면 알림 없음
    expect(isRelevantForBuyer(order, { username: 'c', name: 'c', role: 'buyer', approved: true, isBuyerAdmin: true, allowedMarkets: ['디오트'] })).toBe(true);
  });
});
