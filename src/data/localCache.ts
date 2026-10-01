import type { GroupRule, Transaction, User } from '../types';

/**
 * 오프라인/첫 화면용 로컬 캐시. 서버 데이터가 도착하면 항상 서버 값으로 덮어쓴다.
 * 저장소 접근이 막힌 환경(사생활 보호 모드 등)에서도 앱이 멈추지 않도록 모든 접근을 감싼다.
 */

const KEYS = {
  session: 'saipon.session.v2',
  users: 'saipon.users.v2',
  rules: 'saipon.rules.v2',
  savedId: 'saipon.savedId',
  autoLogin: 'saipon.autoLogin',
  includeFee: 'saipon.includeFee',
};

const SESSION_TTL = 8 * 60 * 60 * 1000; // 자동 로그인 유지 8시간

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(storage: Storage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 공간 부족 등은 무시 */
  }
}
function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ----- 로그인 세션 -----

export function loadSession(): User | null {
  const saved = readJson<{ user: User; loginAt: number }>(localStorage, KEYS.session) || readJson(sessionStorage, KEYS.session);
  if (!saved?.user || Date.now() - Number(saved.loginAt) >= SESSION_TTL) {
    removeKey(KEYS.session);
    return null;
  }
  return saved.user;
}

/** 자동 로그인이면 브라우저를 닫아도 유지(localStorage), 아니면 탭을 닫으면 종료(sessionStorage) */
export function saveSession(user: User, loginAt = Date.now()) {
  const record = { user, loginAt };
  removeKey(KEYS.session);
  writeJson(getAutoLogin() ? localStorage : sessionStorage, KEYS.session, record);
}

/** 사용자 정보만 갱신 (로그인 시각 유지) */
export function refreshSessionUser(user: User) {
  const saved = readJson<{ loginAt: number }>(localStorage, KEYS.session) || readJson<{ loginAt: number }>(sessionStorage, KEYS.session);
  if (saved) saveSession(user, saved.loginAt);
}

export const clearSession = () => removeKey(KEYS.session);

// ----- 로그인 화면 옵션 -----

export const getSavedId = () => {
  try {
    return localStorage.getItem(KEYS.savedId) || '';
  } catch {
    return '';
  }
};
export const setSavedId = (id: string) => (id ? writeJsonRaw(KEYS.savedId, id) : removeKey(KEYS.savedId));
export const getAutoLogin = () => {
  try {
    return localStorage.getItem(KEYS.autoLogin) === 'true';
  } catch {
    return false;
  }
};
export const setAutoLogin = (on: boolean) => writeJsonRaw(KEYS.autoLogin, String(on));

export const getIncludeFee = () => {
  try {
    return localStorage.getItem(KEYS.includeFee) !== 'false';
  } catch {
    return true;
  }
};
export const setIncludeFee = (on: boolean) => writeJsonRaw(KEYS.includeFee, String(on));

function writeJsonRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

// ----- 회원 / 대표거래처 캐시 -----

export const loadCachedUsers = () => readJson<User[]>(localStorage, KEYS.users) || [];
export const saveCachedUsers = (users: User[]) => writeJson(localStorage, KEYS.users, users);
export const loadCachedRules = () => readJson<GroupRule[]>(localStorage, KEYS.rules) || [];
export const saveCachedRules = (rules: GroupRule[]) => writeJson(localStorage, KEYS.rules, rules);

/**
 * 원래 사입온 앱이 이 기기에 저장해 둔 회원 목록 (같은 주소라 읽을 수 있다).
 * 서버가 회원 목록을 안 보여 줄 때 원래 앱처럼 이 저장본으로 아이디 · 비밀번호를 확인한다.
 * DB가 없으면 새로 만들지 않는다.
 */
export function loadLegacyUsers(): Promise<User[]> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('WholesaleLedgerAuthDB');
      req.onupgradeneeded = () => req.transaction?.abort(); // 없던 DB면 만들지 않고 취소
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('users')) {
          db.close();
          return resolve([]);
        }
        const get = db.transaction('users', 'readonly').objectStore('users').getAll();
        get.onsuccess = () => {
          db.close();
          resolve(((get.result || []) as User[]).filter(u => u && u.username && !String(u.uid || '').startsWith('seed_')));
        };
        get.onerror = () => {
          db.close();
          resolve([]);
        };
      };
    } catch {
      resolve([]);
    }
  });
}

// ----- 주문 캐시 (IndexedDB: 데이터가 커서 localStorage 대신 사용) -----

const DB_NAME = 'saipon-cache';
const STORE = 'orders';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCachedOrders(): Promise<Transaction[]> {
  try {
    const db = await openDb();
    return await new Promise(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('all');
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

export async function saveCachedOrders(orders: Transaction[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(orders, 'all');
      tx.oncomplete = tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    /* noop */
  }
}

/** 기기에 남은 이전 버전 캐시까지 모두 비운다 (데이터 초기화 시) */
export async function clearAllCaches(): Promise<void> {
  removeKey(KEYS.users);
  removeKey(KEYS.rules);
  await saveCachedOrders([]);
}
