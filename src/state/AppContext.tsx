import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupRule, Transaction, User } from '../types';
import * as cache from '../data/localCache';
import { deleteOrder as deleteOrderRemote, flushOutbox, newOrderId, onWriteNotice, prepareForSave, saveOrders as saveOrdersRemote, subscribeOrders } from '../data/orders';
import { saveGroupRules, subscribeGroupRules } from '../data/groupRules';
import { fetchMarkets } from '../data/settings';
import { isPermissionDenied, saveStoreOrder as saveStoreOrderRemote, saveUser as saveUserRemote, signOutFirebase, subscribeUsers, userKey } from '../data/users';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, IS_DEMO } from '../data/firebase';
import { filterVisible, isRelevantForBuyer } from '../domain/access';
import { normalizeDate } from '../domain/dates';
import { normalizeMarket } from '../domain/markets';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

interface AppState {
  ready: boolean;
  /** 회원 목록 읽기 상태: 아직 모름 / 읽음 / 서버가 거부(이메일 로그인 필요) */
  usersAccess: 'unknown' | 'ok' | 'denied';
  online: boolean;
  user: User | null;
  users: User[];
  /** DB의 전체 주문 (최근 90일) */
  orders: Transaction[];
  /** 로그인한 사람의 권한으로 볼 수 있는 주문 */
  visibleOrders: Transaction[];
  rules: GroupRule[];
  markets: string[];
  includeFee: boolean;
  toasts: Toast[];

  login: (user: User) => void;
  logout: () => void;
  setIncludeFee: (on: boolean) => void;
  showFeeWaive: boolean;
  setShowFeeWaive: (on: boolean) => void;
  setMarkets: (markets: string[]) => void;
  notify: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;

  /** 저장하고 확정된 주문(서버 id 포함)을 돌려준다. 화면에는 즉시 반영. */
  saveOrders: (list: Transaction[]) => Promise<Transaction[]>;
  /** 새 기록을 화면에 먼저 넣고 서버 저장은 뒤에서 한다. 저장에 실패하면 화면에서 빼고 알린다. */
  addOrdersFast: (list: Transaction[]) => Transaction[];
  deleteOrder: (t: Transaction) => Promise<void>;
  /** 화면에만 즉시 반영 (입력 중 값) */
  patchOrderLocal: (t: Transaction) => void;
  replaceOrdersLocal: (list: Transaction[]) => void;
  saveRules: (rules: GroupRule[]) => Promise<void>;
  saveUser: (user: User) => Promise<User>;
  saveStoreOrder: (order: string[], field?: 'storeOrder' | 'collectionOrder') => Promise<void>;
  removeUserLocal: (username: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** 서버/캐시에서 온 주문을 화면에서 쓰기 좋게 정리 */
function tidy(list: Transaction[]): Transaction[] {
  return list
    .map(t => ({
      ...t,
      date: normalizeDate(t.date),
      market: normalizeMarket(t.market),
      status: String(t.status || '').trim() === '미완료' ? '' : String(t.status || '').trim(),
      expense: Number(t.expense) || 0,
      income: Number(t.income) || 0,
    }))
    .filter(t => String(t.store || '').trim() || t.expense || t.income);
}

function upsert(list: Transaction[], changed: Transaction[]): Transaction[] {
  const byId = new Map(changed.map(t => [t.id, t]));
  const kept = list.filter(t => !byId.has(t.id));
  return [...changed, ...kept];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [user, setUser] = useState<User | null>(() => cache.loadSession());
  const [users, setUsers] = useState<User[]>(() => cache.loadCachedUsers());
  const [orders, setOrders] = useState<Transaction[]>([]);
  const [rules, setRules] = useState<GroupRule[]>(() => cache.loadCachedRules());
  const [markets, setMarkets] = useState<string[]>([]);
  const [includeFee, setIncludeFeeState] = useState(cache.getIncludeFee);
  const [showFeeWaive, setShowFeeWaiveState] = useState(cache.getShowFeeWaive);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [usersAccess, setUsersAccess] = useState<AppState['usersAccess']>('unknown');
  // Firebase 로그인 상태가 바뀌면(로그인/로그아웃) 실시간 동기화를 다시 연결한다
  // null = 아직 확인 전 (저장된 로그인 세션을 불러오기 전에 접속하면 권한 거부가 나므로 기다린다)
  const [authKey, setAuthKey] = useState<string | null>(IS_DEMO ? '' : null);
  useEffect(() => (IS_DEMO ? undefined : onAuthStateChanged(auth, u => setAuthKey(u?.uid || ''))), []);

  const userRef = useRef(user);
  userRef.current = user;
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  // 마지막으로 서버에서 받은 주문 (부분 저장 비교 기준)
  const serverOrdersRef = useRef<Transaction[]>([]);
  const ordersLoaded = useRef(false);
  // 대표거래처는 배열 전체를 한 번에 저장하므로, 서버 값을 받기 전(캐시 상태)에 저장하면 다른 사람의 변경을 덮어쓴다
  const rulesLoaded = useRef(IS_DEMO);

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // 첫 화면: 캐시된 주문을 먼저 보여 주고 서버 데이터로 교체
  useEffect(() => {
    let cancelled = false;
    cache.loadCachedOrders().then(cached => {
      if (!cancelled && !ordersLoaded.current) setOrders(tidy(cached));
      if (!cancelled) setReady(true);
    });
    fetchMarkets().then(m => !cancelled && setMarkets(m));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 실시간 동기화
  useEffect(() => {
    const logError = (what: string) => (e: Error) => {
      console.warn(`${what} 동기화 오류:`, e);
      if (!isPermissionDenied(e)) return;
      if (what === '회원') {
        setUsersAccess('denied');
        // 회원 목록을 못 받으면 이 기기에 저장된 목록(원래 앱 저장본 포함)이라도 보여 준다
        cache.loadLegacyUsers().then(legacy => legacy.length && setUsers(prev => (prev.length ? prev : legacy)));
      }
      // 로그인한 상태인데 서버가 거부하면 이메일 로그인 세션이 없는 것: 다시 로그인하게 한다
      if (userRef.current && what === '주문') {
        notify('서버가 주문 데이터를 보여 주지 않습니다 (권한 거부).\n가입한 이메일 주소로 다시 로그인해 보세요. 그래도 안 되면 DB 규칙을 확인해야 합니다.', 'error');
        cache.clearSession();
        setUser(null);
      }
    };

    if (authKey === null) return;
    const unsubUsers = subscribeUsers(list => {
      setUsersAccess('ok');
      if (list.length === 0) return;
      setUsers(list);
      cache.saveCachedUsers(list);
      const me = userRef.current;
      if (!me) return;
      const fresh = list.find(u => userKey(u.username) === userKey(me.username));
      if (fresh && fresh.role !== 'admin' && fresh.approved === false) {
        // 승인이 취소된 계정은 즉시 로그아웃
        cache.clearSession();
        setUser(null);
      } else if (fresh) {
        setUser(fresh);
        cache.refreshSessionUser(fresh);
      }
    }, logError('회원'));

    onWriteNotice(kind => {
      if (kind === 'slow') notify('서버 응답이 늦어 아직 저장 중입니다. 앱을 닫거나 새로고침하지 말고 잠시 기다려 주세요.', 'info');
      else notify('저장이 완료되었습니다.', 'success');
    });
    flushOutbox().then(n => { if (n > 0) notify(`저장되지 않았던 ${n}건을 서버에 다시 저장했습니다.`, 'success'); });
    const retry = () => { flushOutbox(); };
    window.addEventListener('online', retry);

    const unsubOrders = subscribeOrders(list => {
      const clean = tidy(list);
      const me = userRef.current;
      if (ordersLoaded.current && me?.role === 'buyer') {
        const known = new Set(ordersRef.current.map(t => t.id));
        const added = clean.filter(t => !known.has(t.id) && isRelevantForBuyer(t, me));
        if (added.length > 0) announceNewOrders(added, notify);
      }
      setOrders(clean);
      serverOrdersRef.current = clean;
      ordersLoaded.current = true;
      cache.saveCachedOrders(clean);
    }, logError('주문'));

    const unsubRules = subscribeGroupRules(list => {
      rulesLoaded.current = true;
      setRules(list);
      cache.saveCachedRules(list);
    }, logError('대표거래처'));

    return () => {
      unsubUsers();
      unsubOrders();
      window.removeEventListener('online', retry);
      onWriteNotice(null);
      unsubRules();
    };
  }, [notify, authKey]);

  // 사입삼촌: 브라우저 알림 권한 요청
  useEffect(() => {
    if (user?.role === 'buyer' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, [user?.role]);

  const login = useCallback((u: User) => {
    cache.saveSession(u);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    cache.clearSession();
    signOutFirebase();
    setUser(null);
  }, []);

  const setShowFeeWaive = useCallback((on: boolean) => {
    cache.setShowFeeWaive(on);
    setShowFeeWaiveState(on);
  }, []);
  const setIncludeFee = useCallback((on: boolean) => {
    cache.setIncludeFee(on);
    setIncludeFeeState(on);
  }, []);

  const saveOrders = useCallback(async (list: Transaction[]) => {
    if (list.length === 0) return [];
    // 화면에 있던 직전 값과 비교해 바뀐 필드만 저장 (patchOrderLocal 로 먼저 바뀐 값은 제외하기 위해 서버 기준 값을 쓴다)
    const previous = new Map(serverOrdersRef.current.map(t => [t.id, t]));
    const saved = await saveOrdersRemote(list, previous);
    const oldIds = new Set(list.map(o => o.id).filter(Boolean));
    setOrders(prev => upsert(prev.filter(t => !oldIds.has(t.id)), saved));
    if (!navigator.onLine) notify('오프라인 상태입니다. 연결되면 자동으로 저장됩니다.');
    return saved;
  }, [notify]);

  const addOrdersFast = useCallback((list: Transaction[]) => {
    const prepared = list.map(t => prepareForSave({ ...t, firebaseOrderId: t.firebaseOrderId || newOrderId() }).tx);
    setOrders(prev => upsert(prev, prepared));
    saveOrdersRemote(prepared).catch(e => {
      const ids = new Set(prepared.map(t => t.id));
      setOrders(prev => prev.filter(t => !ids.has(t.id)));
      notify(`저장하지 못했습니다: ${e instanceof Error ? e.message : e}`, 'error');
    });
    return prepared;
  }, [notify]);

  const deleteOrder = useCallback(async (t: Transaction) => {
    setOrders(prev => prev.filter(o => o.id !== t.id));
    await deleteOrderRemote(t);
  }, []);

  const patchOrderLocal = useCallback((t: Transaction) => setOrders(prev => prev.map(o => (o.id === t.id ? t : o))), []);
  const replaceOrdersLocal = useCallback((list: Transaction[]) => setOrders(tidy(list)), []);

  const saveRules = useCallback(async (next: GroupRule[]) => {
    if (!rulesLoaded.current) throw new Error('아직 서버에서 대표거래처 목록을 받지 못했습니다. 잠시 후 다시 시도해주세요.');
    setRules(next);
    cache.saveCachedRules(next);
    await saveGroupRules(next);
    if (!navigator.onLine) notify('오프라인 상태입니다. 연결되면 자동으로 저장됩니다.');
  }, [notify]);

  const saveUser = useCallback(async (u: User) => {
    const saved = await saveUserRemote(u);
    if (!navigator.onLine) notify('오프라인 상태입니다. 연결되면 자동으로 저장됩니다.');
    setUsers(prev => [...prev.filter(x => userKey(x.username) !== saved.username), saved]);
    if (userRef.current && userKey(userRef.current.username) === saved.username) {
      setUser(saved);
      cache.refreshSessionUser(saved);
    }
    return saved;
  }, [notify]);

  // 갯수 집계에서 정한 거래처 순서 (로그인한 본인 것만, 다른 기기에서도 같은 순서로 보인다)
  const saveStoreOrder = useCallback(async (order: string[], field: 'storeOrder' | 'collectionOrder' = 'storeOrder') => {
    const me = userRef.current;
    if (!me) return;
    const next: User = { ...me, [field]: order.length ? order : undefined };
    setUser(next);
    setUsers(prev => prev.map(x => (userKey(x.username) === userKey(me.username) ? { ...x, [field]: next[field] } : x)));
    cache.refreshSessionUser(next);
    await saveStoreOrderRemote(me.username, order, field);
  }, []);

  const removeUserLocal = useCallback((username: string) => {
    setUsers(prev => prev.filter(u => userKey(u.username) !== userKey(username)));
  }, []);

  const visibleOrders = useMemo(() => (user ? filterVisible(orders, user, users, rules) : []), [orders, user, users, rules]);

  const value: AppState = {
    ready, usersAccess, online, user, users, orders, visibleOrders, rules, markets, includeFee, showFeeWaive, toasts,
    login, logout, setIncludeFee, setShowFeeWaive, setMarkets, notify, dismissToast,
    saveOrders, addOrdersFast, deleteOrder, patchOrderLocal, replaceOrdersLocal, saveRules, saveUser, saveStoreOrder, removeUserLocal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function announceNewOrders(added: Transaction[], notify: (text: string, tone?: Toast['tone']) => void) {
  const text = added.length === 1 ? `${added[0].market} ${added[0].store}` : `${added.length}건의 주문`;
  notify(`🔔 새 주문: ${text}`, 'success');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification('사입ON - 새 주문', { body: text, icon: 'pwa-192x192.png' });
    } catch {
      /* 일부 모바일 브라우저는 페이지에서 직접 알림 생성을 막는다 */
    }
  }
}
