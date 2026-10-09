import type { ReactNode } from 'react';
import { BookOpen, Building2, ChevronRight, Database, Layers, Settings, Users } from 'lucide-react';
import type { Nav } from '../App';
import { hasAdminAccess, isAdmin } from '../domain/access';
import { useApp } from '../state/AppContext';
import { APP_VERSION_LABEL } from '../lib/version';
import { FontSizePicker } from '../components/FontSizePicker';
import { Modal, Toggle } from '../components/ui';

function MenuItem({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/50 p-3 text-left hover:border-indigo-600 hover:bg-gray-800">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-300">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-bold text-gray-100">{title}</span>
        <span className="block text-[11px] text-gray-400">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-gray-500" />
    </button>
  );
}

export function SettingsModal({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const { user, includeFee, setIncludeFee, showFeeWaive, setShowFeeWaive } = useApp();
  const go = (type: 'help' | 'data' | 'rules' | 'users' | 'buildings') => {
    onClose();
    nav.open({ type });
  };

  return (
    <Modal title="설정" icon={<Settings className="h-5 w-5 text-indigo-400" />} onClose={onClose} size="sm">
      <div className="space-y-2.5">
        <FontSizePicker />
        <MenuItem icon={<BookOpen className="h-5 w-5" />} title="도움말" description="기능 설명 · 키워드 검색" onClick={() => go('help')} />
        {user?.role !== 'merchant' && (
          <Toggle
            checked={includeFee}
            onChange={setIncludeFee}
            label="사입비 포함 계산"
            description={includeFee ? '지금부터 사입비는 계산에 포함됩니다. 완료 건당 4,000원이 청구액에 더해집니다. (끄면 끈 날부터만 적용, 이전 날짜는 그대로)' : '지금부터 사입비는 계산에서 제외됩니다. 이전 날짜에 받은 사입비는 그대로 계산됩니다.'}
          />
        )}
        {user?.role !== 'merchant' && (
          <Toggle
            checked={showFeeWaive}
            onChange={setShowFeeWaive}
            label="사입비 제외 체크칸 사용"
            description={showFeeWaive ? '수금 상세 내역의 주문마다 "사입비 제외" 체크칸이 보입니다.' : '체크칸을 숨깁니다. 이미 제외한 주문은 그대로 유지됩니다.'}
          />
        )}
        {user?.role !== 'merchant' && <MenuItem icon={<Layers className="h-5 w-5" />} title="대표거래처 관리" description="여러 상호를 대표 거래처로 묶기, 월사입 설정" onClick={() => go('rules')} />}
        {hasAdminAccess(user) && <MenuItem icon={<Users className="h-5 w-5" />} title="회원 관리" description="가입 승인, 권한, 담당 건물/거래처, 비밀번호 초기화" onClick={() => go('users')} />}
        {isAdmin(user) && <MenuItem icon={<Building2 className="h-5 w-5" />} title="건물 목록 관리" description="주문 입력 시 고르는 건물명 목록" onClick={() => go('buildings')} />}
        {hasAdminAccess(user) && <MenuItem icon={<Database className="h-5 w-5" />} title="데이터 관리" description="엑셀 가져오기/내보내기, 백업 · 복원, 중복 정리" onClick={() => go('data')} />}
        <p className="pt-1 text-center text-[11px] text-gray-500">사입ON {APP_VERSION_LABEL}</p>
      </div>
    </Modal>
  );
}
