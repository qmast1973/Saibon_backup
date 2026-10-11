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
