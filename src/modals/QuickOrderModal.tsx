import { useMemo, useState } from 'react';
import { CheckCircle2, Trash2, Zap } from 'lucide-react';
import type { Transaction } from '../types';
import type { Nav } from '../App';
import { formatFloor, formatRoom } from '../domain/format';
import { findDuplicateOrders } from '../domain/ledger';
import { normalizeMarket, RECEIVABLE_MARKET } from '../domain/markets';
import { composeRoomWithWholesale, parseOrderText, type ParsedOrder } from '../domain/orderParser';
import { useApp } from '../state/AppContext';
import { Button, Modal, Textarea } from '../components/ui';
import { DuplicateDialog } from './OrderEntryModal';

const EXAMPLE = `카톡이나 문자 주문을 그대로 붙여넣으세요.

예시)
예시상호
디 3-12 바지 2장
청 B1-5 스커트
상호B/디오트/3층/12호`;

type EditableField = 'retailStore' | 'wholesaleStore' | 'market' | 'floor' | 'room' | 'remark';
const COLUMNS: { key: EditableField; label: string; tone: string }[] = [
  { key: 'retailStore', label: '소매 상호', tone: 'text-gray-300' },
  { key: 'wholesaleStore', label: '도매처', tone: 'text-emerald-300' },
  { key: 'market', label: '건물', tone: 'text-sky-300' },
  { key: 'floor', label: '층', tone: 'text-gray-100' },
  { key: 'room', label: '호수', tone: 'text-gray-100' },
];

export function QuickOrderModal({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const { user, visibleOrders, saveOrders, notify } = useApp();
  const defaultStore = user?.role === 'merchant' ? user.storeName || user.name : '';
  const [text, setText] = useState('');
  // 붙여넣은 글을 분석한 결과. 사용자가 고친 값은 edits 에 따로 보관해 다시 분석해도 유지한다.
  const parsed = useMemo(() => parseOrderText(text, defaultStore), [text, defaultStore]);
  const [edits, setEdits] = useState<Record<number, Partial<ParsedOrder>>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<{ dupes: Transaction[]; fresh: Transaction[]; all: Transaction[] } | null>(null);

  const rows = parsed.map((p, i) => ({ index: i, ...p, ...edits[i] })).filter(r => !removed.has(r.index));

  const onTextChange = (v: string) => {
    setText(v);
    setEdits({});
    setRemoved(new Set());
  };

  const toTransactions = (): Transaction[] =>
    rows.map(r => {
      const market = normalizeMarket(r.market, r.room);
      return {
        id: '',
        date: nav.date,
        store: (r.retailStore || defaultStore || '상호 미지정').trim(),
        merchantStoreName: (r.retailStore || defaultStore || '').trim(),
        merchantId: user?.role === 'merchant' ? user.username : '',
        merchantName: user?.role === 'merchant' ? user.name : '',
        market,
        floor: r.floor.trim(),
        room: composeRoomWithWholesale(r.room.trim(), r.wholesaleStore),
        manager: user?.name || '',
        actualManager: user?.role === 'buyer' ? user.name : '',
        region: '',
        expense: 0,
        income: 0,
        status: '',
        remark: r.remark.trim(),
        recordType: market === RECEIVABLE_MARKET ? 'receivable' : 'order',
        orderAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    });

  const persist = async (list: Transaction[]) => {
    if (list.length === 0) return;
    setSaving(true);
    try {
      await saveOrders(list);
      notify(`${list.length}건을 ${nav.date} 주문으로 등록했습니다.`, 'success');
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const list = toTransactions();
    const { duplicates: dupes, fresh } = findDuplicateOrders(list, visibleOrders);
    if (dupes.length > 0) setDuplicates({ dupes, fresh, all: list });
    else persist(list);
  };

  return (
    <Modal
      big
      title="빠른주문"
      subtitle={`붙여넣은 글을 자동으로 나눠 ${nav.date} 주문으로 등록합니다.`}
      icon={<Zap className="h-5 w-5 text-yellow-300" />}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-gray-400">총 <b className="text-sm text-white">{rows.length}</b>건</span>
          <Button tone="primary" onClick={submit} disabled={rows.length === 0 || saving}>
            <CheckCircle2 className="h-4 w-4" />{saving ? '저장 중...' : `${rows.length}건 주문 등록`}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-gray-300">
            <span>카톡/문자 붙여넣기</span>
            {text && <button type="button" onClick={() => onTextChange('')} className="text-gray-500 hover:text-gray-300">지우기</button>}
          </div>
          <Textarea value={text} onChange={e => onTextChange(e.target.value)} placeholder={EXAMPLE} className="h-36 font-mono text-xs leading-relaxed lg:h-[28rem]" />
        </div>

        <div className="lg:col-span-7">
          <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-gray-300">
            <span>분석 결과 <span className="ml-1 rounded-full bg-emerald-900/60 px-2 py-0.5 text-emerald-300">{rows.length}건</span></span>
            <span className="text-gray-500">칸을 눌러 바로 고칠 수 있어요</span>
          </div>
          <div className="h-64 space-y-2 overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-2 lg:h-[28rem]">
            {rows.length === 0 ? (
              <p className="flex h-full items-center justify-center p-6 text-center text-xs text-gray-500">
                {text.trim() ? '주문 정보를 찾지 못했습니다. 건물명·층·호수가 들어 있는지 확인해주세요.' : '왼쪽에 주문 글을 넣으면 건물 · 층 · 호수 · 상호가 자동으로 나뉩니다.'}
              </p>
            ) : (
              rows.map((r, n) => (
                <div key={r.index} className="space-y-2 rounded-xl border border-gray-800 bg-gray-900 p-2.5 text-xs">
                  <div className="flex items-center gap-2 border-b border-gray-800 pb-1.5">
                    <b className="text-gray-400">#{n + 1}</b>
                    <span className="flex-1 truncate text-[11px] text-gray-500">원문: {r.rawText}</span>
                    <span className="text-[11px] text-gray-400">{normalizeMarket(r.market, r.room)} {formatFloor(r.floor)} {formatRoom(r.room)}</span>
                    <button type="button" onClick={() => setRemoved(prev => new Set(prev).add(r.index))} className="p-1 text-gray-500 hover:text-rose-400" aria-label="삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {COLUMNS.map(c => (
                      <label key={c.key} className="block">
                        <span className="mb-0.5 block text-[10px] text-gray-500">{c.label}</span>
                        <input
                          value={r[c.key]}
                          onChange={e => setEdits(prev => ({ ...prev, [r.index]: { ...prev[r.index], [c.key]: e.target.value } }))}
                          className={`w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 font-bold outline-none focus:border-indigo-500 ${c.tone}`}
                        />
                      </label>
                    ))}
                  </div>
                  <input
                    value={r.remark}
                    placeholder="비고 · 품목 · 수량"
                    onChange={e => setEdits(prev => ({ ...prev, [r.index]: { ...prev[r.index], remark: e.target.value } }))}
                    className="w-full rounded border border-gray-800 bg-gray-950 px-2 py-1 text-gray-300 outline-none focus:border-indigo-500"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {duplicates && (
        <DuplicateDialog
          date={nav.date}
          labels={duplicates.dupes.map(t => `${t.store} · ${t.market} ${formatFloor(t.floor)} ${formatRoom(t.room)}`)}
          freshCount={duplicates.fresh.length}
          allCount={duplicates.all.length}
          onOnlyFresh={() => { setDuplicates(null); persist(duplicates.fresh); }}
          onAll={() => { setDuplicates(null); persist(duplicates.all); }}
          onCancel={() => setDuplicates(null)}
        />
      )}
    </Modal>
  );
}
