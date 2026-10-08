import { useState } from 'react';
import { Building2, ChevronDown, ChevronUp, Minus, Plus, Trash2 } from 'lucide-react';
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

  // 이 줄 바로 아래에 구분선을 넣는다 (위 입력칸에 쓴 글자가 구분선 이름, 비었으면 '구분')
  const addSeparator = (index: number) => { // index = 이 줄 아래 (-1이면 맨 위)
    const label = name.trim().replace(/^=+\s*|\s*=+$/g, '') || '구분';
    const sep = `===== ${label} =====`;
    if (list.includes(sep)) return notify('같은 이름의 구분선이 이미 있습니다. 위 입력칸에 다른 이름을 쓰고 다시 눌러 주세요.', 'error');
    setList([...list.slice(0, index + 1), sep, ...list.slice(index + 1)]);
  };
  const move = (index: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    setList(next);
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
      <p className="mb-2 text-[11px] text-gray-400">
        구분선은 위 입력칸에 이름(예: 동대문, 남대문)을 쓰고, 넣고 싶은 건물 줄의 <Minus className="inline h-3 w-3" /> 버튼을 누르면 그 줄 바로 아래에 들어갑니다. 맨 위에 넣으려면 아래 "맨 위에 구분선" 버튼을 누르세요. 구분선은 목록에서 선택되지 않습니다.
      </p>
      <div className="mb-2 flex justify-end">
        <Button size="sm" onClick={() => addSeparator(-1)}><Minus className="h-3.5 w-3.5" />맨 위에 구분선</Button>
      </div>
      <ul className="space-y-1">
        {list.map((m, i) => {
          const sep = MARKET_SEPARATOR_RE.test(m);
          return (
            <li key={m} className={cx('flex items-center justify-between gap-1 rounded-lg border px-3 py-1', sep ? 'border-dashed border-gray-700 text-xs text-gray-400' : 'border-gray-800 bg-gray-950 text-sm text-gray-100')}>
              <span className="min-w-0 flex-1 truncate">{m}</span>
              <span className="flex shrink-0 items-center">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30" aria-label={`${m} 위로`}><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === list.length - 1} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30" aria-label={`${m} 아래로`}><ChevronDown className="h-4 w-4" /></button>
                {!sep && <button type="button" onClick={() => addSeparator(i)} className="p-1.5 text-gray-500 hover:text-sky-300" aria-label={`${m} 아래에 구분선 넣기`} title="이 줄 아래에 구분선 넣기"><Minus className="h-4 w-4" /></button>}
                <button type="button" onClick={() => setList(list.filter(x => x !== m))} className="p-1.5 text-gray-500 hover:text-rose-400" aria-label={`${m} 삭제`}><Trash2 className="h-4 w-4" /></button>
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
