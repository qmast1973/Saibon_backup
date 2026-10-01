import { Calculator, HandCoins, LogOut, MessageSquare, Settings, Store, WifiOff } from 'lucide-react';
import type { Nav } from '../App';
import { describeUser } from '../data/users';
import { isBuyerLike } from '../domain/access';
import { useApp } from '../state/AppContext';
import { InstallButton } from '../components/InstallButton';
import { cx } from '../components/ui';
import { Logo } from '../components/Logo';

const pill = 'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-bold transition sm:text-xs';

export function Header({ nav }: { nav: Nav }) {
  const { user, online, logout } = useApp();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-30 bg-indigo-950 text-white shadow-md">
      <div className="mx-auto flex max-w-7xl items-start justify-between gap-2 px-3 py-2.5 sm:px-4">
        <Logo className="h-14 sm:h-20" />

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {!online && (
              <span className={cx(pill, 'bg-amber-600')}>
                <WifiOff className="h-3.5 w-3.5" /> 오프라인
              </span>
            )}
            <InstallButton />
            <button type="button" onClick={() => nav.setView('board')} className={cx(pill, 'bg-amber-500 hover:bg-amber-400')}>
              <MessageSquare className="h-3.5 w-3.5" /> 게시판
            </button>
            <button
              type="button"
              onClick={() => nav.open({ type: 'profile', username: user.username })}
              title="내 정보"
              className={cx(pill, 'max-w-[150px] border border-indigo-700 bg-indigo-900 hover:bg-indigo-800 sm:max-w-[220px]')}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              <span className="truncate">{describeUser(user)}</span>
            </button>
            <button type="button" onClick={logout} title="로그아웃" aria-label="로그아웃" className={cx(pill, 'bg-rose-600 hover:bg-rose-500')}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isBuyerLike(user) && (
              <button type="button" onClick={() => nav.setView('workday')} className={cx(pill, 'bg-blue-600 hover:bg-blue-500')}>
                <Calculator className="h-3.5 w-3.5" /> 주문처리
              </button>
            )}
            {user.role === 'local' && (
              <button type="button" onClick={() => nav.open({ type: 'merchantInfo' })} className={cx(pill, 'bg-emerald-700 hover:bg-emerald-600')}>
                <Store className="h-3.5 w-3.5" /> 담당 거래처
              </button>
            )}
            {user.role !== 'merchant' && (
              <button type="button" onClick={() => nav.setView('collection')} className={cx(pill, 'bg-emerald-700 hover:bg-emerald-600')}>
                <HandCoins className="h-3.5 w-3.5" /> 수금관리
              </button>
            )}
            <button type="button" onClick={() => nav.open({ type: 'settings' })} className={cx(pill, 'bg-gray-700 hover:bg-gray-600')}>
              <Settings className="h-3.5 w-3.5" /> 설정
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
