import { MapPin, Phone, Store } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { EmptyState, Modal } from '../components/ui';

/** 지방삼촌: 관리자가 지정한 담당 상인 연락처 · 주소 */
export function MerchantInfoModal({ onClose }: { onClose: () => void }) {
  const { user, users } = useApp();
  const assigned = new Set(user?.assignedMerchants || []);
  const merchants = users.filter(u => u.role === 'merchant' && assigned.has(u.username));

  return (
    <Modal title="담당 거래처" subtitle="관리자가 지정한 상인 거래처의 연락처와 주소입니다." icon={<Store className="h-5 w-5 text-emerald-400" />} onClose={onClose}>
      {merchants.length === 0 ? (
        <EmptyState>지정된 담당 거래처가 없습니다. 관리자에게 요청하세요.</EmptyState>
      ) : (
        <div className="space-y-2">
          {merchants.map(m => (
            <div key={m.username} className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-sm">
              <p className="font-bold text-gray-100">{m.storeName || m.name} <span className="text-xs font-normal text-gray-500">{m.name}</span></p>
              {m.phone && <a href={`tel:${m.phone}`} className="mt-1 flex items-center gap-1.5 text-xs text-sky-300"><Phone className="h-3.5 w-3.5" />{m.phone}</a>}
              {m.address && <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400"><MapPin className="h-3.5 w-3.5" />{m.address}</p>}
              {m.businessNumber && <p className="mt-1 text-[11px] text-gray-500">사업자 {m.businessNumber}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
