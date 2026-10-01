import { useMemo, useState, type FormEvent } from 'react';
import { Layers, Link2, Pencil, Plus, Unlink } from 'lucide-react';
import type { GroupRule } from '../types';
import { getBillingStore } from '../domain/groups';
import { compact, fuzzyIncludes, sortKo, uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, StoreSearch, Toggle, cx } from '../components/ui';

interface Draft {
  id?: string;
  storeName: string;
  matchType: 'exact' | 'prefix';
  effectiveFrom: string;
  note: string;
}
const emptyDraft = (): Draft => ({ storeName: '', matchType: 'exact', effectiveFrom: '', note: '' });

/**
 * 대표거래처 관리: 여러 소매 상호(종속)를 하나의 대표 거래처로 묶어 수금 · 조회를 합친다.
 */
export function GroupRulesModal({ onClose }: { onClose: () => void }) {
  const { users, rules, orders, saveRules, notify } = useApp();
  const [selected, setSelected] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [unlink, setUnlink] = useState<GroupRule | null>(null);
  const [saving, setSaving] = useState(false);

  const groups = useMemo(
    () => uniqueSorted([...users.filter(u => u.role === 'merchant').map(u => u.storeName || u.name), ...rules.map(r => r.groupName)]),
    [users, rules],
  );
  const shownGroups = groups.filter(g => fuzzyIncludes(g, groupFilter));
  const current = selected || groups[0] || '';
  const mapped = rules.filter(r => compact(r.groupName) === compact(current)).sort((a, b) => sortKo(a.storeName, b.storeName));
  const knownStores = useMemo(() => uniqueSorted([...orders.map(o => o.store), ...users.map(u => u.storeName)]), [orders, users]);
  const monthlyRule = mapped.find(r => r.isMonthlyPurchase);
  const [monthlyAmount, setMonthlyAmount] = useState('');

  const persist = async (next: GroupRule[], message: string) => {
    setSaving(true);
    try {
      await saveRules(next);
      notify(message, 'success');
      return true;
    } catch (e) {
      notify(`저장 실패: ${e instanceof Error ? e.message : e}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const storeName = draft.storeName.trim();
    if (!current || !storeName) return notify('대표 거래처와 종속 상호를 모두 입력해주세요.', 'error');
    if (compact(storeName) === compact(current)) return notify('대표 거래처 자신은 종속으로 넣을 수 없습니다.', 'error');
    const dup = rules.some(r => r.id !== draft.id && compact(r.storeName) === compact(storeName) && compact(r.groupName) === compact(current) && r.matchType === draft.matchType);
    if (dup) return notify('이미 등록된 종속 거래처입니다.', 'error');

    // 다른 대표에 이미 묶여 있으면 알려 준다 (그래도 저장은 허용)
    const elsewhere = getBillingStore(storeName, rules.filter(r => r.id !== draft.id));
    const rule: GroupRule = {
      id: draft.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      storeName,
      groupName: current,
      matchType: draft.matchType,
      effectiveFrom: draft.effectiveFrom,
      note: draft.note.trim(),
      createdAt: rules.find(r => r.id === draft.id)?.createdAt || new Date().toISOString(),
      isMonthlyPurchase: monthlyRule?.isMonthlyPurchase,
      monthlyPurchaseAmount: monthlyRule?.monthlyPurchaseAmount,
    };
    const next = draft.id ? rules.map(r => (r.id === draft.id ? rule : r)) : [...rules, rule];
    const ok = await persist(next, draft.id ? `'${storeName}' 연결을 수정했습니다.` : `'${storeName}'을(를) '${current}'에 묶었습니다.`);
    if (ok) {
      if (compact(elsewhere) !== compact(storeName) && compact(elsewhere) !== compact(current)) notify(`참고: '${storeName}'은(는) '${elsewhere}'에도 묶여 있습니다.`);
      setDraft(emptyDraft());
    }
  };

  const setMonthly = (on: boolean, amount = Number(monthlyAmount) || monthlyRule?.monthlyPurchaseAmount || 0) => {
    const next = rules.map(r => (compact(r.groupName) === compact(current) ? { ...r, isMonthlyPurchase: on, monthlyPurchaseAmount: on ? amount : undefined } : r));
    persist(next, on ? `'${current}'을(를) 월사입 거래처로 설정했습니다.` : '월사입 설정을 해제했습니다.');
  };

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    setSelected(name);
    setNewGroup('');
    setDraft(emptyDraft());
    setMonthlyAmount('');
  };

  const groupList = (
    <div className="space-y-2">
      <Input value={groupFilter} onChange={e => setGroupFilter(e.target.value)} placeholder="대표 거래처 찾기 (초성)" className="py-2 text-xs" />
      <div className="max-h-[40dvh] space-y-1 overflow-y-auto lg:max-h-[55dvh]">
        {current && !groups.includes(current) && (
          <div className="rounded-lg border border-violet-500 bg-violet-700 px-2.5 py-2 text-xs font-bold text-white">{current} <span className="text-[10px] opacity-80">(새 대표)</span></div>
        )}
        {shownGroups.map(g => {
          const count = rules.filter(r => compact(r.groupName) === compact(g)).length;
          return (
            <button key={g} type="button" onClick={() => { setSelected(g); setDraft(emptyDraft()); setMonthlyAmount(''); }}
              className={cx('flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-bold', compact(g) === compact(current) ? 'border-violet-500 bg-violet-700 text-white' : 'border-gray-800 bg-gray-950 text-gray-300 hover:bg-gray-800')}>
              <span className="truncate">{g}</span>
              {count > 0 && <Badge className="bg-violet-950 text-violet-200">{count}</Badge>}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <Input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="새 대표 거래처명" className="py-2 text-xs" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addGroup())} />
        <Button size="sm" onClick={addGroup} aria-label="대표 추가"><Plus className="h-4 w-4" /></Button>
      </div>
    </div>
  );

  return (
    <Modal title="대표거래처 관리" subtitle="여러 상호를 하나의 대표 거래처로 묶으면 수금 · 조회가 합쳐집니다." icon={<Layers className="h-5 w-5 text-violet-400" />} onClose={onClose} size="xl" z="z-[220]">
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {groupList}

        <div className="space-y-4">
          {!current ? (
            <EmptyState>왼쪽에서 대표 거래처를 고르거나 새로 만드세요.</EmptyState>
          ) : (
            <>
              <div className="rounded-xl border border-violet-800 bg-violet-950/40 p-3">
                <p className="text-base font-black text-white">{current}</p>
                <p className="text-[11px] text-violet-300">종속 거래처 {mapped.length}곳</p>
                {mapped.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <Toggle checked={!!monthlyRule} onChange={on => setMonthly(on)} label="월사입 거래처" description="월 고정 사입비를 받는 거래처는 수금 시 건당 사입비를 빼고 계산합니다." />
                    {monthlyRule && (
                      <div className="flex items-end gap-2">
                        <Field label="월 사입비 (원)" className="flex-1">
                          <Input inputMode="numeric" value={monthlyAmount || String(monthlyRule.monthlyPurchaseAmount || '')} onChange={e => setMonthlyAmount(e.target.value.replace(/[^0-9]/g, ''))} />
                        </Field>
                        <Button onClick={() => setMonthly(true, Number(monthlyAmount) || 0)} disabled={saving}>금액 저장</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form onSubmit={submit} className="space-y-2.5 rounded-xl border border-gray-800 bg-gray-950 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-gray-300"><Link2 className="h-4 w-4" />{draft.id ? '종속 거래처 수정' : '종속 거래처 추가'}</p>
                <StoreSearch value={draft.storeName} onChange={v => setDraft(d => ({ ...d, storeName: v }))} knownStores={knownStores} rules={rules} placeholder="묶을 상호 (초성 가능)" required />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={draft.matchType} onChange={e => setDraft(d => ({ ...d, matchType: e.target.value as Draft['matchType'] }))} aria-label="매칭 방식">
                    <option value="exact">상호 일치</option>
                    <option value="prefix">앞글자 일치 (지점 전체)</option>
                  </Select>
                  <Input type="date" value={draft.effectiveFrom} onChange={e => setDraft(d => ({ ...d, effectiveFrom: e.target.value }))} aria-label="적용 시작일" title="적용 시작일 (비우면 전체 기간)" />
                </div>
                <Input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="비고 / 특이사항" />
                <div className="flex justify-end gap-2">
                  {draft.id && <Button onClick={() => setDraft(emptyDraft())}>수정 취소</Button>}
                  <Button tone="violet" type="submit" disabled={saving}>{draft.id ? '수정 저장' : '묶기'}</Button>
                </div>
              </form>

              <div className="space-y-1.5">
                {mapped.length === 0 && <EmptyState>아직 묶인 상호가 없습니다.</EmptyState>}
                {mapped.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-900 p-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <b className="text-sm text-gray-100">{r.storeName}</b>
                        <Badge className="bg-gray-800 text-gray-300">{r.matchType === 'prefix' ? '앞글자 일치' : '상호 일치'}</Badge>
                        {r.effectiveFrom && <Badge className="bg-gray-800 text-gray-400">{r.effectiveFrom}~</Badge>}
                      </p>
                      {r.note && <p className="mt-0.5 truncate text-gray-500">{r.note}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => setDraft({ id: r.id, storeName: r.storeName, matchType: r.matchType, effectiveFrom: r.effectiveFrom, note: r.note || '' })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" tone="danger" onClick={() => setUnlink(r)}><Unlink className="h-3.5 w-3.5" />해제</Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {unlink && (
        <ConfirmDialog
          title="연결 해제"
          message={`'${unlink.storeName}'을(를) '${unlink.groupName}'에서 뺄까요?`}
          confirmLabel="해제"
          onCancel={() => setUnlink(null)}
          onConfirm={() => {
            const target = unlink;
            setUnlink(null);
            if (draft.id === target.id) setDraft(emptyDraft());
            persist(rules.filter(r => r.id !== target.id), `'${target.storeName}' 연결을 해제했습니다.`);
          }}
        />
      )}
    </Modal>
  );
}
