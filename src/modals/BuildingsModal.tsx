import { useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { saveMarkets } from '../data/settings';
import { MARKET_SEPARATOR_RE } from '../domain/markets';
import { useApp } from '../state/AppContext';
import { Button, Input, Modal, cx } from '../components/ui';

/** 주문 입력 때 고르는 건물 목록 (순서 유지, '===== 남대문 =====' 같은 구분선 사용 가능) */
export function BuildingsModal({ onClose }: { onClose: () => void }) {
  const { markets, setMarkets, notify } = useApp();
  const [list, setList] = useState(markets);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const add = () => {
    const v = name.trim();
    if (!v) return;
    if (list.includes(v)) return notify('이미 있는 건물입니다.', 'error');
    setList([...list, v]);
    setName('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveMarkets(list);
      setMarkets(list);
      notify('건물 목록을 저장했습니다.', 'success');
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="건물 목록 관리" icon={<Building2 className="h-5 w-5 text-sky-400" />} onClose={onClose} size="sm" z="z-[220]"
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" onClick={save} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button></>}
    >
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="새 건물명" />
        <Button tone="primary" onClick={add} disabled={!name.trim()}><Plus className="h-4 w-4" />추가</Button>
      </div>
      <ul className="space-y-1">
        {list.map(m => (
          <li key={m} className={cx('flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm', MARKET_SEPARATOR_RE.test(m) ? 'border-transparent text-center text-xs text-gray-500' : 'border-gray-800 bg-gray-950 text-gray-100')}>
            <span>{m}</span>
            <button type="button" onClick={() => setList(list.filter(x => x !== m))} className="p-1 text-gray-500 hover:text-rose-400" aria-label={`${m} 삭제`}><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
