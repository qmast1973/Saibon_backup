import type { User } from '../types';

/**
 * DB 보안 규칙이 보는 '승인 명단'을 회원 목록에서 계산한다.
 *  - approved: 관리자가 승인한 계정의 로그인 번호(uid) — 이 명단에 있어야 DB를 읽고 쓸 수 있다
 *  - admins: 그중 관리자 · 서브관리자 — 승인 명단을 고칠 수 있다
 * approved 가 명확히 true 인 회원만 넣는다 (스스로 role 만 admin 으로 적어 둔 승인 전 기록은 제외).
 */
export interface Approvals {
  approved: string[];
  admins: string[];
}

export function desiredApprovals(users: User[]): Approvals {
  const ok = users.filter(u => u.approved === true && !!u.uid);
  return {
    approved: [...new Set(ok.map(u => u.uid as string))],
    admins: [...new Set(ok.filter(u => u.role === 'admin' || (u.role === 'buyer' && u.isBuyerAdmin === true)).map(u => u.uid as string))],
  };
}

/** 현재 서버 명단과 원하는 명단의 차이를 RTDB 다중 경로 업데이트로 만든다 (추가 = true, 제거 = null) */
export function approvalUpdates(current: Approvals, wanted: Approvals, keepUid: string): Record<string, true | null> {
  const out: Record<string, true | null> = {};
  const diff = (path: string, cur: string[], want: string[]) => {
    const have = new Set(cur);
    const need = new Set(want);
    for (const uid of need) if (!have.has(uid)) out[`${path}/${uid}`] = true;
    for (const uid of have) if (!need.has(uid) && uid !== keepUid) out[`${path}/${uid}`] = null; // 지금 관리하는 사람 자신은 지우지 않는다
  };
  diff('approvedUids', current.approved, wanted.approved);
  diff('adminUids', current.admins, wanted.admins);
  return out;
}
