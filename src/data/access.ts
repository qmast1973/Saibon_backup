import { get, ref, update } from 'firebase/database';
import type { User } from '../types';
import { approvalUpdates, desiredApprovals, type Approvals } from '../domain/approvals';
import { IS_DEMO, rtdb, withTimeout, write } from './firebase';

/**
 * DB 보안 규칙이 쓰는 승인 명단 (adminUids · approvedUids).
 * 관리자가 승인한 계정의 로그인 번호만 명단에 올라가고, 규칙은 그 명단에 있는 계정만 DB를 읽고 쓰게 한다.
 */

const keysOf = (v: unknown) => Object.keys((v || {}) as object);

async function readList(path: string): Promise<string[]> {
  const snap = await withTimeout(get(ref(rtdb, path)), 10000, `${path} 조회`);
  return keysOf(snap.val());
}

/** 관리자 · 서브관리자 세션에서 회원 목록(서버 기준)이 바뀔 때마다 승인 명단을 맞춘다 */
export async function syncApprovals(users: User[], myUid: string): Promise<void> {
  if (IS_DEMO || !myUid || users.length === 0) return;
  const wanted = desiredApprovals(users);
  const current: Approvals = { approved: await readList('approvedUids'), admins: await readList('adminUids') };
  const updates = approvalUpdates(current, wanted, myUid);
  if (Object.keys(updates).length > 0) await write(update(ref(rtdb), updates), '승인 명단 저장');
}

/** 이 계정이 승인 명단에 있는지 (자기 것만 읽을 수 있다) */
export async function isApproved(uid: string): Promise<boolean> {
  try {
    return (await withTimeout(get(ref(rtdb, `approvedUids/${uid}`)), 10000, '승인 확인')).val() === true;
  } catch {
    return false;
  }
}

/** 서버에 관리자 명단이 아직 없는지 (없으면 처음 로그인하는 계정이 최초 관리자가 된다) */
export async function noAdminRegistered(): Promise<boolean> {
  const snap = await withTimeout(get(ref(rtdb, 'adminUids')), 10000, '관리자 명단 조회');
  return !snap.exists();
}

export async function claimFirstAdmin(uid: string): Promise<void> {
  await write(update(ref(rtdb), { [`adminUids/${uid}`]: true, [`approvedUids/${uid}`]: true }), '최초 관리자 등록');
}
