import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { get, onValue, ref, remove, set } from 'firebase/database';
import type { User, UserRole } from '../types';
import { auth, rtdb, withTimeout } from './firebase';

/** RTDB users/{username} */
export const userKey = (username: string) => String(username || '').trim().toLowerCase();

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function cleanUsers(data: unknown): User[] {
  return Object.values((data || {}) as Record<string, User>).filter(u => u && u.username);
}

export function subscribeUsers(onChange: (users: User[]) => void, onError?: (e: Error) => void) {
  return onValue(ref(rtdb, 'users'), snap => onChange(cleanUsers(snap.val())), e => onError?.(e));
}

export async function fetchUsers(): Promise<User[]> {
  const snap = await withTimeout(get(ref(rtdb, 'users')), 10000, '회원 조회');
  return cleanUsers(snap.val());
}

export async function saveUser(user: User): Promise<User> {
  const key = userKey(user.username);
  if (!key) throw new Error('아이디가 없습니다.');
  const payload: User = JSON.parse(JSON.stringify({ ...user, username: key, updatedAt: new Date().toISOString() }));
  await withTimeout(set(ref(rtdb, `users/${key}`), payload), 10000, '회원 저장');
  return payload;
}

export async function deleteUser(username: string): Promise<void> {
  await withTimeout(remove(ref(rtdb, `users/${userKey(username)}`)), 10000, '회원 삭제');
}

/** 관리자를 제외한 회원 전체 삭제 */
export async function deleteNonAdminUsers(users: User[]): Promise<void> {
  await Promise.all(users.filter(u => u.role !== 'admin').map(u => deleteUser(u.username)));
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': '이미 가입된 이메일 주소입니다. 로그인하거나 비밀번호를 재설정하세요.',
  'auth/weak-password': '비밀번호는 6자 이상 입력해주세요.',
  'auth/invalid-email': '올바른 이메일 주소 형식이 아닙니다.',
  'auth/too-many-requests': '연속된 로그인 실패로 잠시 차단되었습니다. 잠시 후 다시 시도해주세요.',
  'auth/network-request-failed': '네트워크 연결이 불안정합니다. 인터넷 연결을 확인해주세요.',
};
const authMessage = (e: unknown, fallback: string) => AUTH_ERRORS[(e as { code?: string })?.code || ''] || fallback;

const WRONG_LOGIN = '아이디 또는 비밀번호가 올바르지 않습니다.';

/**
 * 로그인. 아이디/이메일/이름으로 회원을 찾고 저장된 비밀번호 해시와 비교한다.
 * 해시가 없는 예전 계정은 Firebase 인증(이메일)으로 확인된 경우에만 로그인시키고 해시를 채운다.
 */
export async function signIn(identifier: string, password: string, knownUsers: User[]): Promise<User> {
  const id = identifier.trim().toLowerCase();
  if (!id || !password) throw new Error('아이디와 비밀번호를 입력해주세요.');

  let users = knownUsers;
  try {
    users = await fetchUsers();
  } catch {
    // 오프라인이면 마지막으로 받은 회원 목록으로 확인
  }
  const user = users.find(
    u => userKey(u.username) === id || String(u.email || '').toLowerCase() === id || String(u.name || '').trim() === identifier.trim(),
  );
  const hash = await sha256(password);

  if (user?.passwordHash && user.passwordHash === hash) return user;

  // 해시가 다르거나 없으면 Firebase 이메일 인증으로 한 번 더 확인한다.
  // (이메일로 비밀번호를 재설정한 경우에도 새 비밀번호로 로그인되도록 해시를 갱신)
  const email = user?.email || (id.includes('@') ? id : '');
  if (!email) throw new Error(user && !user.passwordHash ? '비밀번호가 설정되지 않은 계정입니다. 관리자에게 비밀번호 초기화를 요청하세요.' : WRONG_LOGIN);

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile: User = user || {
      uid: cred.user.uid,
      email,
      username: email.split('@')[0],
      name: cred.user.displayName || '회원',
      role: 'merchant',
      approved: false,
      createdAt: new Date().toISOString(),
    };
    const saved = await saveUser({ ...profile, passwordHash: hash });
    await signOut(auth).catch(() => undefined);
    return saved;
  } catch (e) {
    const code = (e as { code?: string })?.code || '';
    throw new Error(code === 'auth/too-many-requests' || code === 'auth/network-request-failed' ? authMessage(e, WRONG_LOGIN) : WRONG_LOGIN);
  }
}

export interface SignUpInput {
  email: string;
  password: string;
  username: string;
  name: string;
  phone: string;
  role: UserRole;
  storeName?: string;
  businessNumber?: string;
  address?: string;
  assignedRegion?: string;
}

/** 회원가입: 관리자 승인 전까지 approved=false */
export async function signUp(input: SignUpInput, existing: User[]): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const username = userKey(input.username) || email.split('@')[0];
  if (existing.some(u => userKey(u.username) === username)) throw new Error('이미 사용 중인 아이디입니다.');

  let uid = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, input.password);
    uid = cred.user.uid;
    await updateProfile(cred.user, { displayName: input.name }).catch(() => undefined);
  } catch (e) {
    const code = (e as { code?: string })?.code || '';
    // 이메일 인증 기능이 꺼져 있는 프로젝트에서도 가입은 진행 (비밀번호 해시로 로그인)
    if (code in AUTH_ERRORS && code !== 'auth/network-request-failed') throw new Error(authMessage(e, '회원가입에 실패했습니다.'));
  }

  const isMerchant = input.role === 'merchant';
  const saved = await saveUser({
    uid,
    email,
    username,
    name: input.name.trim(),
    phone: input.phone.trim(),
    passwordHash: await sha256(input.password),
    role: input.role,
    approved: false,
    storeName: isMerchant ? input.storeName?.trim() : '',
    businessNumber: isMerchant ? input.businessNumber?.trim() : '',
    address: isMerchant ? input.address?.trim() : '',
    assignedRegion: input.role === 'local' ? input.assignedRegion?.trim() : '',
    allowedMarkets: [],
    assignedMerchants: [],
    createdAt: new Date().toISOString(),
    createdBy: 'self_register',
  });
  await signOut(auth).catch(() => undefined);
  return saved;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!clean.includes('@')) throw new Error('가입 시 사용한 이메일 주소를 입력해주세요.');
  try {
    await sendPasswordResetEmail(auth, clean);
  } catch (e) {
    throw new Error(authMessage(e, '재설정 메일을 보내지 못했습니다.'));
  }
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth).catch(() => undefined);
}

/** 임시 비밀번호 발급: 영문 대문자+숫자 */
export function makeTempPassword(): string {
  return `PW${Math.random().toString(36).slice(2, 8).toUpperCase()}1`;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: '관리자',
  buyer: '사입삼촌',
  local: '지방삼촌',
  merchant: '상인',
};

export function describeUser(u: User): string {
  if (u.role === 'buyer') return `${u.name} · ${u.isBuyerAdmin ? '서브관리자' : '사입삼촌'}`;
  if (u.role === 'local') return `${u.name} · ${u.assignedRegion || '지방삼촌'}`;
  if (u.role === 'merchant') return `${u.name} · ${u.storeName || '상인'}`;
  return `${u.name} · 관리자`;
}
