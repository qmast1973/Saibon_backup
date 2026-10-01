import { useMemo, useState } from 'react';
import { CalendarCheck, Coins, UserCheck } from 'lucide-react';
import type { Transaction } from '../types';
import type { Nav } from '../App';
import { ROLE_LABEL } from '../data/users';
import { excelRowToTransaction, isReceivableRow, type ExcelRow } from '../domain/excel';
import { duplicateKey } from '../domain/ledger';
import { uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Button, Modal, cx } from '../components/ui';

type Step = 'receivable' | 'dates' | 'managers';
type ManagerRole = 'buyer' | 'local' | 'admin' | 'merchant' | 'other';

function DatePicker({ rows, selected, onChange }: { rows: ExcelRow[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.date || '날짜 없음', (m.get(r.date || '날짜 없음') || 0) + 1));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  return (
    <>
      <div className="mb-2 flex gap-2">
        <Button size="sm" onClick={() => onChange(new Set(counts.map(([d]) => d)))}>전체 선택</Button>
        <Button size="sm" onClick={() => onChange(new Set())}>전체 해제</Button>
      </div>
      <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
        {counts.map(([date, n]) => {
          const on = selected.has(date);
          return (
            <button key={date} type="button" onClick={() => { const next = new Set(selected); if (on) next.delete(date); else next.add(date); onChange(next); }}
              className={cx('rounded-lg border px-2 py-2 text-left text-xs font-bold', on ? 'border-indigo-400 bg-indigo-700 text-white' : 'border-gray-700 bg-gray-950 text-gray-400')}>
              {date} <span className="font-normal opacity-80">({n}건)</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * 엑셀 가져오기 3단계: ① 미수금 날짜 선택 ② 주문 날짜 선택 ③ 담당자 역할 확인 → 이미 있는 주문은 건너뛰고 저장
 */
export function ExcelImportModal({ rows, nav, onClose }: { rows: ExcelRow[]; nav: Nav; onClose: () => void }) {
  const { users, orders, saveOrders, notify } = useApp();
  const receivables = useMemo(() => rows.filter(isReceivableRow), [rows]);
  const normals = useMemo(() => rows.filter(r => !isReceivableRow(r)), [rows]);
  const [step, setStep] = useState<Step>(receivables.length > 0 ? 'receivable' : 'dates');
  const [recDates, setRecDates] = useState(() => new Set(receivables.map(r => r.date || '날짜 없음')));
  const [ordDates, setOrdDates] = useState(() => new Set(normals.map(r => r.date || '날짜 없음')));
  const [roles, setRoles] = useState<Record<string, ManagerRole>>({});
  const [saving, setSaving] = useState(false);

  const chosen = useMemo(
    () => [...receivables.filter(r => recDates.has(r.date || '날짜 없음')), ...normals.filter(r => ordDates.has(r.date || '날짜 없음'))],
    [receivables, normals, recDates, ordDates],
  );
  const managers = useMemo(() => uniqueSorted(chosen.map(r => r.sourceManager)), [chosen]);

  const toManagers = () => {
    if (chosen.length === 0) return notify('가져올 날짜를 1개 이상 선택해주세요.', 'error');
    // 이미 가입한 회원 이름과 같으면 그 역할을 기본값으로
    const guess: Record<string, ManagerRole> = {};
    managers.forEach(m => {
      const u = users.find(x => x.name === m);
      if (u) guess[m] = u.role;
    });
    setRoles(prev => ({ ...guess, ...prev }));
    setStep('managers');
  };

  const finish = async () => {
    if (managers.some(m => !roles[m])) return notify('모든 담당자의 역할을 선택해주세요.', 'error');
    setSaving(true);
    try {
      const existing = new Set(orders.map(duplicateKey));
      const fresh: Transaction[] = [];
      for (const r of chosen) {
        const t = excelRowToTransaction(r, roles[r.sourceManager] || '');
        const key = duplicateKey(t);
        if (existing.has(key)) continue;
        existing.add(key);
        fresh.push(t);
      }
      await saveOrders(fresh);
      const latest = chosen.map(r => r.date).filter(Boolean).sort().pop();
      if (latest) nav.setDate(latest);
      notify(`엑셀 ${fresh.length}건을 등록했습니다.${chosen.length - fresh.length ? ` (이미 있는 ${chosen.length - fresh.length}건 제외)` : ''}`, 'success');
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const titles: Record<Step, [string, string, React.ReactNode]> = {
    receivable: ['1단계 · 미수금 날짜', '미수금 행은 날짜별로 고릅니다. 선택한 날짜의 미수금이 모두 들어갑니다.', <Coins key="c" className="h-5 w-5 text-amber-400" />],
    dates: ['2단계 · 주문 날짜', '가져올 주문 날짜를 고르세요.', <CalendarCheck key="d" className="h-5 w-5 text-indigo-400" />],
    managers: ['3단계 · 담당자 확인', '엑셀의 담당자가 어떤 역할인지 정하면 수금/처리 화면에 맞게 들어갑니다.', <UserCheck key="u" className="h-5 w-5 text-emerald-400" />],
  };
  const [title, subtitle, icon] = titles[step];

  return (
    <Modal title={title} subtitle={subtitle} icon={icon} onClose={onClose} size="lg" z="z-[260]"
      footer={
        <>
          <span className="mr-auto text-xs text-gray-400">선택 {chosen.length}건 / 전체 {rows.length}건</span>
          {step === 'receivable' && <Button tone="primary" onClick={() => setStep('dates')}>다음</Button>}
          {step === 'dates' && (
            <>
              {receivables.length > 0 && <Button onClick={() => setStep('receivable')}>이전</Button>}
              <Button tone="primary" onClick={managers.length ? toManagers : finish} disabled={saving}>{managers.length ? '다음' : '가져오기'}</Button>
            </>
          )}
          {step === 'managers' && (
            <>
              <Button onClick={() => setStep('dates')}>이전</Button>
              <Button tone="success" onClick={finish} disabled={saving}>{saving ? '저장 중...' : `${chosen.length}건 가져오기`}</Button>
            </>
          )}
        </>
      }
    >
      {step === 'receivable' && <DatePicker rows={receivables} selected={recDates} onChange={setRecDates} />}
      {step === 'dates' && (normals.length ? <DatePicker rows={normals} selected={ordDates} onChange={setOrdDates} /> : <p className="text-sm text-gray-400">일반 주문 행이 없습니다.</p>)}
      {step === 'managers' && (
        <div className="space-y-2">
          {managers.map(m => (
            <div key={m} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-950 p-2.5">
              <span className="text-sm font-bold text-gray-100">{m} <span className="text-[11px] font-normal text-gray-500">({chosen.filter(r => r.sourceManager === m).length}건)</span></span>
              <div className="flex flex-wrap gap-1">
                {(['buyer', 'local', 'admin', 'other'] as ManagerRole[]).map(role => (
                  <button key={role} type="button" onClick={() => setRoles(prev => ({ ...prev, [m]: role }))}
                    className={cx('rounded-lg border px-2 py-1 text-xs font-bold', roles[m] === role ? 'border-emerald-400 bg-emerald-700 text-white' : 'border-gray-700 bg-gray-900 text-gray-300')}>
                    {role === 'other' ? '기타' : ROLE_LABEL[role]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
