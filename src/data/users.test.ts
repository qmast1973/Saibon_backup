import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firebase 없이 로그인 흐름만 검사: DB 읽기는 이메일 로그인 상태에서만 허용되는 상황을 흉내 낸다
const state = { signedIn: false, db: {} as Record<string, unknown>, writes: [] as { path: string; value: unknown }[] };
const denied = () => Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });

vi.mock('./firebase', () => ({
  IS_DEMO: false,
  auth: { get currentUser() { return state.signedIn ? { uid: 'uid-admin', email: 'boss@example.com' } : null; } },
  rtdb: {},
  withTimeout: (p: Promise<unknown>) => p,
  write: (p: Promise<unknown>) => p.then(() => undefined),
}));
vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => path,
  get: async () => {
    if (!state.signedIn) throw denied();
    return { val: () => state.db };
  },
  set: async (path: string, value: unknown) => {
    state.writes.push({ path, value });
  },
  remove: async () => undefined,
  onValue: () => () => undefined,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: async (_a: unknown, email: string, pw: string) => {
    if (email !== 'boss@example.com' || pw !== 'secret1') throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
    state.signedIn = true;
    return { user: { uid: 'uid-admin' } };
  },
  signOut: async () => { state.signedIn = false; },
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(),
  updateProfile: vi.fn(),
}));

const { signIn, sha256 } = await import('./users');

beforeEach(async () => {
  state.signedIn = false;
  state.writes = [];
  state.db = {
    boss: { username: 'boss', name: '사장', role: 'admin', approved: true, email: 'boss@example.com', uid: 'uid-admin', passwordHash: await sha256('secret1') },
  };
});

describe('로그인 (DB가 이메일 로그인 상태에서만 열리는 경우)', () => {
  it('회원 목록을 못 읽을 때 아이디로 로그인하면 이메일 로그인을 안내한다', async () => {
    await expect(signIn('boss', 'secret1', [])).rejects.toThrow('이메일 주소로 로그인');
  });

  it('이메일로 로그인하면 기존 관리자 계정을 찾고 덮어쓰지 않는다', async () => {
    const user = await signIn('boss@example.com', 'secret1', []);
    expect(user).toMatchObject({ username: 'boss', role: 'admin', approved: true });
    expect(state.writes).toHaveLength(0);
    expect(state.signedIn).toBe(true); // 로그인 상태 유지 (데이터를 읽으려면 필요)
  });

  it('한 번 이메일로 로그인해 둔 기기에서는 아이디 + 비밀번호로 로그인된다', async () => {
    state.signedIn = true;
    expect(await signIn('boss', 'secret1', [])).toMatchObject({ username: 'boss' });
  });

  it('비밀번호가 틀리면 거절', async () => {
    await expect(signIn('boss@example.com', 'wrong', [])).rejects.toThrow('올바르지 않습니다');
  });

  it('Firebase 계정만 있고 회원 정보가 없으면 같은 아이디가 있어도 덮어쓰지 않고 새 아이디로 만든다', async () => {
    state.db = { boss: { username: 'boss', name: '다른 사람', role: 'admin', approved: true, email: 'other@example.com' } };
    const user = await signIn('boss@example.com', 'secret1', []);
    expect(user.username).not.toBe('boss');
    expect(user).toMatchObject({ role: 'merchant', approved: false });
    expect(state.writes.map(w => w.path)).toEqual([`users/${user.username}`]);
  });
});
