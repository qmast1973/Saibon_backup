import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Transaction } from './types';
import { getBusinessDate, isOrderTimeBlocked, ORDER_BLOCKED_MESSAGE } from './domain/dates';
import { useApp } from './state/AppContext';
import { Toasts } from './components/ui';
import { AuthScreen } from './screens/AuthScreen';
import { Header } from './screens/Header';
import { MainScreen } from './screens/MainScreen';
import { WorkdayScreen } from './screens/WorkdayScreen';
import { StatsScreen } from './screens/StatsScreen';
import { CollectionScreen } from './screens/CollectionScreen';
import { BoardScreen } from './screens/BoardScreen';
import { OrderEntryModal } from './modals/OrderEntryModal';
import { QuickOrderModal } from './modals/QuickOrderModal';
import { SettingsModal } from './modals/SettingsModal';
import { ProfileModal } from './modals/ProfileModal';
import { UsersModal } from './modals/UsersModal';
import { GroupRulesModal } from './modals/GroupRulesModal';
import { DataModal } from './modals/DataModal';
import { BuildingsModal } from './modals/BuildingsModal';
import { MerchantInfoModal } from './modals/MerchantInfoModal';
import { AdminCreateModal } from './modals/AdminCreateModal';
import { HelpModal } from './modals/HelpModal';

/** 화면 전체를 덮는 작업 화면 */
export type View = 'workday' | 'stats' | 'collection' | 'board' | null;

/** 위에 뜨는 창 (동시에 여러 개가 쌓일 수 있다) */
export type Dialog =
  | { type: 'order'; tx?: Transaction }
  | { type: 'quick' }
  | { type: 'settings' }
  | { type: 'profile'; username: string }
  | { type: 'users' }
  | { type: 'rules' }
  | { type: 'data' }
  | { type: 'buildings' }
  | { type: 'merchantInfo' }
  | { type: 'adminCreate' }
  | { type: 'help' };

export interface Nav {
  date: string;
  setDate: (date: string) => void;
  open: (d: Dialog) => void;
  close: (type: Dialog['type']) => void;
  setView: (v: View) => void;
  /** 신규 주문 창 (영업시간 확인 포함) */
  newOrder: () => void;
}

export default function App() {
  const { ready, user, notify } = useApp();
  const [date, setDate] = useState(getBusinessDate);
  const [view, setView] = useState<View>(null);
  const [dialogs, setDialogs] = useState<Dialog[]>([]);

  const open = useCallback((d: Dialog) => setDialogs(prev => [...prev.filter(x => x.type !== d.type), d]), []);
  const close = useCallback((type: Dialog['type']) => setDialogs(prev => prev.filter(x => x.type !== type)), []);

  const newOrder = useCallback(() => {
    if (user?.role !== 'admin' && isOrderTimeBlocked()) {
      notify(ORDER_BLOCKED_MESSAGE, 'error');
      return;
    }
    open({ type: 'order' });
  }, [user?.role, open, notify]);

  const nav: Nav = useMemo(() => ({ date, setDate, open, close, setView, newOrder }), [date, open, close, newOrder]);

  // 로그인 직후 역할별 첫 화면: 사입삼촌은 주문처리, 상인은 주문 입력
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    const name = user?.username ?? null;
    if (name === lastUser.current) return;
    lastUser.current = name;
    setDialogs([]);
    setView(null);
    if (user?.role === 'buyer') setView('workday');
    if (user?.role === 'merchant' && !isOrderTimeBlocked()) open({ type: 'order' });
  }, [user, open]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-950">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="text-xs font-semibold text-gray-400">사입ON 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-gray-950 text-gray-100 antialiased">
      <Header nav={nav} />
      <MainScreen nav={nav} />

      {view === 'workday' && <WorkdayScreen nav={nav} />}
      {view === 'stats' && <StatsScreen nav={nav} />}
      {view === 'collection' && <CollectionScreen nav={nav} />}
      {view === 'board' && <BoardScreen onClose={() => setView(null)} />}

      {dialogs.map(d => {
        const onClose = () => close(d.type);
        switch (d.type) {
          case 'order': return <OrderEntryModal key="order" editing={d.tx} nav={nav} onClose={onClose} />;
          case 'quick': return <QuickOrderModal key="quick" nav={nav} onClose={onClose} />;
          case 'settings': return <SettingsModal key="settings" nav={nav} onClose={onClose} />;
          case 'profile': return <ProfileModal key="profile" username={d.username} onClose={onClose} />;
          case 'users': return <UsersModal key="users" nav={nav} onClose={onClose} />;
          case 'rules': return <GroupRulesModal key="rules" onClose={onClose} />;
          case 'data': return <DataModal key="data" nav={nav} onClose={onClose} />;
          case 'buildings': return <BuildingsModal key="buildings" onClose={onClose} />;
          case 'merchantInfo': return <MerchantInfoModal key="merchantInfo" onClose={onClose} />;
          case 'adminCreate': return <AdminCreateModal key="adminCreate" onClose={onClose} />;
          case 'help': return <HelpModal key="help" onClose={onClose} />;
        }
      })}
      <Toasts />
    </div>
  );
}
