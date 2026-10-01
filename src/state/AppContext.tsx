import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupRule, Transaction, User } from '../types';
import * as cache from '../data/localCache';
import { deleteOrder as deleteOrderRemote, saveOrders as saveOrdersRemote, subscribeOrders } from '../data/orders';
import { saveGroupRules, subscribeGroupRules } from '../data/groupRules';
import { fetchMarkets } from '../data/settings';
import { saveUser as saveUserRemote, signOutFirebase, subscribeUsers, userKey } from '../data/users';
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
  setMarkets: (markets: string[]) => void;
  notify: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;

  /** 저장하고 확정된 주문(서버 id 포함)을 돌려준다. 화면에는 즉시 반영. */
  saveOrders: (list: Transaction[]) => Promise<Transaction[]>;
  deleteOrder: (t: Transaction) => Promise<void>;
  /** 화면에만 즉시 반영 (입력 중 값) */
  patchOrderLocal: (t: Transaction) => void;
  replaceOrdersLocal: (list: Transaction[]) => void;
  saveRules: (rules: GroupRule[]) => Promise<void>;
  saveUser: (user: User) => Promise<User>;
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
  const [toasts, setToasts] = useState<Toast[]>([]);

  const userRef = useRef(user);
  userRef.current = user;
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const ordersLoaded = useRef(false);

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
    const logError = (what: string) => (e: Error) => console.warn(`${what} 동기화 오류:`, e);

    const unsubUsers = subscribeUsers(list => {
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

    const unsubOrders = subscribeOrders(list => {
      const clean = tidy(list);
      const me = userRef.current;
      if (ordersLoaded.current && me?.role === 'buyer') {
        const known = new Set(ordersRef.current.map(t => t.id));
        const added = clean.filter(t => !known.has(t.id) && isRelevantForBuyer(t, me));
        if (added.length > 0) announceNewOrders(added, notify);
      }
      setOrders(clean);
      ordersLoaded.current = true;
      cache.saveCachedOrders(clean);
    }, logError('주문'));

    const unsubRules = subscribeGroupRules(list => {
      setRules(list);
      cache.saveCachedRules(list);
    }, logError('대표거래처'));

    return () => {
      unsubUsers();
      unsubOrders();
      unsubRules();
    };
  }, [notify]);

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

  const setIncludeFee = useCallback((on: boolean) => {
    cache.setIncludeFee(on);
    setIncludeFeeState(on);
  }, []);

  const saveOrders = useCallback(async (list: Transaction[]) => {
    if (list.length === 0) return [];
    const saved = await saveOrdersRemote(list);
    const oldIds = new Set(list.map(o => o.id).filter(Boolean));
    setOrders(prev => upsert(prev.filter(t => !oldIds.has(t.id)), saved));
    if (!navigator.onLine) notify('오프라인 상태입니다. 연결되면 자동으로 저장됩니다.');
    return saved;
  }, [notify]);

  const deleteOrder = useCallback(async (t: Transaction) => {
    setOrders(prev => prev.filter(o => o.id !== t.id));
    await deleteOrderRemote(t);
  }, []);

  const patchOrderLocal = useCallback((t: Transaction) => setOrders(prev => prev.map(o => (o.id === t.id ? t : o))), []);
  const replaceOrdersLocal = useCallback((list: Transaction[]) => setOrders(tidy(list)), []);

  const saveRules = useCallback(async (next: GroupRule[]) => {
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

  const removeUserLocal = useCallback((username: string) => {
    setUsers(prev => prev.filter(u => userKey(u.username) !== userKey(username)));
  }, []);

  const visibleOrders = useMemo(() => (user ? filterVisible(orders, user, users, rules) : []), [orders, user, users, rules]);

  const value: AppState = {
    ready, online, user, users, orders, visibleOrders, rules, markets, includeFee, toasts,
    login, logout, setIncludeFee, setMarkets, notify, dismissToast,
    saveOrders, deleteOrder, patchOrderLocal, replaceOrdersLocal, saveRules, saveUser, removeUserLocal,
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
