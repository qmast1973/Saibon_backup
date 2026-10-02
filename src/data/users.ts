import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword, updateProfile } from 'firebase/auth';
import { get, onValue, ref, remove, set } from 'firebase/database';
import type { User, UserRole } from '../types';
import { auth, IS_DEMO, rtdb, withTimeout, write } from './firebase';
import { loadLegacyUsers } from './localCache';

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
  if (IS_DEMO) return () => undefined;
  return onValue(ref(rtdb, 'users'), snap => onChange(cleanUsers(snap.val())), e => onError?.(e));
}

export async function fetchUsers(): Promise<User[]> {
  if (IS_DEMO) throw new Error('미리보기');
  const snap = await withTimeout(get(ref(rtdb, 'users')), 10000, '회원 조회');
  return cleanUsers(snap.val());
}

export async function saveUser(user: User): Promise<User> {
  const key = userKey(user.username);
  if (!key) throw new Error('아이디가 없습니다.');
  const payload: User = JSON.parse(JSON.stringify({ ...user, username: key, updatedAt: new Date().toISOString() }));
  if (!IS_DEMO) await write(set(ref(rtdb, `users/${key}`), payload), '회원 저장');
  return payload;
}

export type OrderField = 'storeOrder' | 'collectionOrder';

/** 갯수 집계 · 수금관리의 거래처 순서만 저장한다 (다른 회원 정보는 건드리지 않음). 빈 배열이면 기본 순서로 되돌린다. */
export async function saveStoreOrder(username: string, order: string[], field: OrderField = 'storeOrder'): Promise<void> {
  const key = userKey(username);
  if (!key) throw new Error('아이디가 없습니다.');
  if (!IS_DEMO) await write(set(ref(rtdb, `users/${key}/${field}`), order.length ? order : null), '거래처 순서 저장');
}

export async function deleteUser(username: string): Promise<void> {
  if (!IS_DEMO) await write(remove(ref(rtdb, `users/${userKey(username)}`)), '회원 삭제');
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

const WRONG_LOGIN = '이메일 또는 비밀번호가 올바르지 않습니다.';

export const isPermissionDenied = (e: unknown) => /permission[_ ]denied/i.test(String((e as Error)?.message || e));

const findUser = (users: User[], identifier: string) => {
  const id = identifier.trim().toLowerCase();
  return users.find(
    u => userKey(u.username) === id || String(u.email || '').toLowerCase() === id || String(u.name || '').trim() === identifier.trim(),
  );
};

/** 회원 정보 쓰기 권한을 위해 Firebase 이메일 로그인 상태를 만든다. 실패해도 조용히 넘어간다. */
async function ensureFirebaseSession(email: string | undefined, password: string): Promise<boolean> {
  if (!email) return !!auth.currentUser;
  if (auth.currentUser?.email?.toLowerCase() === email.toLowerCase()) return true;
  return signInWithEmailAndPassword(auth, email, password).then(() => true, () => false);
}

/**
 * 로그인.
 * DB 보안 규칙상 회원/주문 정보는 Firebase 이메일 로그인 상태에서만 읽을 수 있다.
 * 그래서 아이디(또는 이메일)로 회원을 찾되, 이메일 계정으로 Firebase 로그인도 함께 해 두고 로그아웃 전까지 유지한다.
 */
export async function signIn(identifier: string, password: string, knownUsers: User[]): Promise<User> {
  const id = identifier.trim().toLowerCase();
  if (!id || !password) throw new Error('이메일과 비밀번호를 입력해주세요.');
  const hash = await sha256(password);

  // 1) 회원 목록 읽기 (이미 Firebase 로그인 상태이거나 규칙이 열려 있으면 성공)
  let users = knownUsers;
  let denied = false;
  try {
    users = await fetchUsers();
  } catch (e) {
    denied = isPermissionDenied(e);
    // 서버가 회원 목록을 안 보여 주면 이 기기에 저장된 목록(새 앱 + 원래 앱)으로 확인한다 (원래 앱과 같은 방식)
    const legacy = await loadLegacyUsers();
    users = [...knownUsers, ...legacy.filter(l => !knownUsers.some(k => userKey(k.username) === userKey(l.username)))];
  }
  let user = findUser(users, identifier);

  // 2) 저장된 비밀번호와 같으면 통과 (이메일이 있으면 Firebase 로그인 상태도 맞춰 둔다)
  if (user?.passwordHash && user.passwordHash === hash) {
    // 이메일 로그인 상태도 맞춰 둔다 (실패해도 원래 앱처럼 로그인은 진행)
    await ensureFirebaseSession(user.email, password);
    return user;
  }

  // 3) Firebase 이메일 로그인으로 확인
  const email = user?.email || (id.includes('@') ? id : '');
  if (!email) {
    if (denied) throw new Error('서버가 회원 정보를 보여 주지 않습니다. 가입할 때 쓴 이메일 주소로 로그인해 주세요.');
    throw new Error(user && !user.passwordHash ? '비밀번호가 설정되지 않은 계정입니다. 관리자에게 비밀번호 초기화를 요청하세요.' : WRONG_LOGIN);
  }

  let uid = '';
  try {
    uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid;
  } catch (e) {
    const code = (e as { code?: string })?.code || '';
    throw new Error(code === 'auth/too-many-requests' || code === 'auth/network-request-failed' ? authMessage(e, WRONG_LOGIN) : WRONG_LOGIN);
  }

  // 4) 로그인된 상태로 회원 목록을 다시 읽어 실제 계정을 찾는다
  try {
    users = await fetchUsers();
  } catch (e) {
    throw new Error(isPermissionDenied(e) ? '로그인은 됐지만 회원 정보를 읽을 권한이 없습니다. Firebase 데이터베이스 규칙을 확인해야 합니다.' : '회원 정보를 불러오지 못했습니다. 네트워크를 확인해주세요.');
  }
  user = users.find(u => u.uid === uid) || users.find(u => String(u.email || '').toLowerCase() === email.toLowerCase()) || findUser(users, identifier);

  if (user) {
    // 이메일로 비밀번호를 바꾼 경우 등: 새 비밀번호로 갱신
    return user.passwordHash === hash ? user : saveUser({ ...user, passwordHash: hash });
  }

  // 5) Firebase 계정만 있고 회원 정보가 없으면 승인 대기 회원으로 새로 만든다 (기존 아이디는 절대 덮어쓰지 않음)
  let key = userKey(email.split('@')[0]).replace(/[^a-z0-9._-]/g, '') || 'user';
  if (users.some(u => userKey(u.username) === key)) key = `${key}_${uid.slice(0, 6).toLowerCase()}`;
  return saveUser({
    uid,
    email,
    username: key,
    name: auth.currentUser?.displayName || key,
    role: 'merchant',
    approved: false,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    createdBy: 'firebase_login',
  });
}

/** 이메일 앞부분으로 만든 내부 고유키 (RTDB 키에 쓸 수 없는 문자는 뺀다) */
export const emailKey = (email: string) => userKey(String(email || '').split('@')[0]).replace(/[^a-z0-9_-]/g, '') || 'user';

/** 이미 쓰는 키면 뒤에 번호를 붙여 비어 있는 키를 돌려준다 */
export function freeKey(base: string, users: User[]): string {
  let key = base;
  for (let n = 2; users.some(u => userKey(u.username) === key); n++) key = `${base}${n}`;
  return key;
}

/** 닉네임이 이미 쓰이는지 (대소문자 · 공백 무시, 닉네임이 없는 예전 회원은 이름 대신 내부 키와 비교) */
export const nicknameTaken = (users: User[], nickname: string, exceptUsername?: string) => {
  const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
  return users.some(u => userKey(u.username) !== userKey(exceptUsername || '') && norm(u.nickname || u.username) === norm(nickname));
};

export interface SignUpInput {
  email: string;
  password: string;
  nickname: string;
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
  const nickname = input.nickname.trim();
  if (nickname.length < 2 || nickname.length > 12) throw new Error('닉네임은 2~12자로 입력해주세요.');
  if (!/^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_\- ]+$/.test(nickname)) throw new Error('닉네임은 한글, 영문, 숫자만 쓸 수 있습니다.');
  if (nicknameTaken(existing, nickname)) throw new Error('이미 사용 중인 닉네임입니다.');
  if (input.password.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');

  // DB는 이메일 로그인 상태에서만 열리므로 이메일 계정이 없으면 가입시키지 않는다
  let uid: string;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, input.password);
    uid = cred.user.uid;
    await updateProfile(cred.user, { displayName: input.name }).catch(() => undefined);
  } catch (e) {
    throw new Error(authMessage(e, '회원가입에 실패했습니다. 잠시 후 다시 시도해주세요.'));
  }

  // 로그인된 상태에서 최신 회원 목록을 다시 읽어, 같은 키(이메일 앞부분)나 닉네임이 있으면 덮어쓰지 않고 뒤에 번호를 붙인다
  const fresh = await fetchUsers().catch(() => existing);
  const finalName = freeKey(emailKey(email), fresh);
  let finalNick = nickname;
  for (let n = 2; nicknameTaken(fresh, finalNick); n++) finalNick = `${nickname}${n}`;

  const isMerchant = input.role === 'merchant';
  const saved = await saveUser({
    uid,
    email,
    username: finalName,
    nickname: finalNick,
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

/**
 * 내 비밀번호 변경: 이메일 로그인 비밀번호도 같이 바꿔야 다음 로그인 때 서버 접속 권한이 유지된다.
 */
export async function changeOwnFirebasePassword(newPassword: string): Promise<void> {
  if (IS_DEMO || !auth.currentUser) return;
  try {
    await updatePassword(auth.currentUser, newPassword);
  } catch (e) {
    const code = (e as { code?: string })?.code || '';
    throw new Error(code === 'auth/requires-recent-login'
      ? '보안을 위해 로그아웃 후 다시 로그인한 다음 비밀번호를 바꿔 주세요.'
      : authMessage(e, '비밀번호를 바꾸지 못했습니다.'));
  }
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth).catch(() => undefined);
}

/**
 * 관리자가 다른 사람의 이메일 로그인 계정을 만든다.
 * 같은 Firebase 앱으로 만들면 지금 로그인한 관리자가 새 계정으로 바뀌어 버리므로 보조 앱 인스턴스를 쓴다.
 */
export async function createEmailAccountForOther(email: string, password: string): Promise<string> {
  if (IS_DEMO) return `demo_${Date.now()}`;
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth } = await import('firebase/auth');
  const secondary = initializeApp(auth.app.options, `create-${Date.now()}`);
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(secondary), email, password);
    return cred.user.uid;
  } catch (e) {
    throw new Error(authMessage(e, '이메일 계정을 만들지 못했습니다.'));
  } finally {
    await deleteApp(secondary).catch(() => undefined);
  }
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
