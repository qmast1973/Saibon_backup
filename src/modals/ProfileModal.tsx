import { useMemo, useState, type FormEvent } from 'react';
import { UserPen } from 'lucide-react';
import type { UserRole } from '../types';
import { changeOwnFirebasePassword, nicknameTaken, ROLE_LABEL, sha256, userKey } from '../data/users';
import { hasAdminAccess, isAdmin } from '../domain/access';
import { MARKET_SEPARATOR_RE, NON_BUILDING_MARKETS, normalizeMarket } from '../domain/markets';
import { uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { Button, Field, Input, Modal, PasswordInput, Select, Toggle, cx } from '../components/ui';

/** 내 정보 수정, 또는 관리자가 다른 회원 정보를 수정 */
export function ProfileModal({ username, onClose }: { username: string; onClose: () => void }) {
  const { user: me, users, markets, orders, saveUser, notify } = useApp();
  const target = users.find(u => userKey(u.username) === userKey(username)) || (me && userKey(me.username) === userKey(username) ? me : undefined);
  const editingOther = !!target && userKey(target.username) !== userKey(me?.username || '');
  const admin = isAdmin(me);
  const canEditMarkets = hasAdminAccess(me);

  const [form, setForm] = useState(() => ({
    role: target?.role || ('merchant' as UserRole),
    nickname: target?.nickname || '',
    name: target?.name || '',
    email: target?.email || '',
    phone: target?.phone || '',
    storeName: target?.storeName || '',
    businessNumber: target?.businessNumber || '',
    address: target?.address || '',
    region: target?.assignedRegion || '',
    approved: target?.approved ?? false,
    isBuyerAdmin: target?.isBuyerAdmin ?? false,
    isMonthly: target?.isMonthlyPurchase ?? false,
    monthlyAmount: String(target?.monthlyPurchaseAmount || ''),
    allowedMarkets: (target?.allowedMarkets || []).map(m => normalizeMarket(m)),
    assignedMerchants: target?.assignedMerchants || [],
    password: '',
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(p => ({ ...p, [k]: v }));
  const toggleIn = (k: 'allowedMarkets' | 'assignedMerchants', v: string) =>
    setForm(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }));

  const regions = useMemo(() => uniqueSorted(['합성동', ...orders.map(o => o.region), form.region]), [orders, form.region]);
  const buildingOptions = useMemo(
    () => uniqueSorted([...markets.filter(m => !MARKET_SEPARATOR_RE.test(m) && !NON_BUILDING_MARKETS.has(m)).map(m => normalizeMarket(m)), ...form.allowedMarkets]),
    [markets, form.allowedMarkets],
  );
  // 다른 사입삼촌/지방삼촌이 이미 맡은 건물/거래처 표시
  const takenMarkets = useMemo(() => {
    const map = new Map<string, string[]>();
    users.filter(u => u.role === 'buyer' && u.username !== target?.username).forEach(u =>
      (u.allowedMarkets || []).forEach(m => map.set(normalizeMarket(m), [...(map.get(normalizeMarket(m)) || []), u.name])),
    );
    return map;
  }, [users, target?.username]);
  const merchants = users.filter(u => u.role === 'merchant');
  const takenMerchants = useMemo(() => {
    const map = new Map<string, string[]>();
    users.filter(u => u.role === 'local' && u.username !== target?.username).forEach(u =>
      (u.assignedMerchants || []).forEach(m => map.set(m, [...(map.get(m) || []), u.name])),
    );
    return map;
  }, [users, target?.username]);

  if (!target) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const role = editingOther && admin ? form.role : target.role;
    if (!form.name.trim()) return notify('이름을 입력해주세요.', 'error');
    const nickname = form.nickname.trim();
    if (nickname && (nickname.length < 2 || nickname.length > 12)) return notify('닉네임은 2~12자로 입력해주세요.', 'error');
    if (nickname && nicknameTaken(users, nickname, target.username)) return notify('이미 사용 중인 닉네임입니다.', 'error');
    if (role === 'merchant' && !form.storeName.trim()) return notify('상호를 입력해주세요.', 'error');
    if (role === 'local' && !form.region.trim()) return notify('담당 지역을 선택해주세요.', 'error');
    if (form.password && form.password.length < 6) return notify('새 비밀번호는 6자 이상이어야 합니다.', 'error');

    setSaving(true);
    try {
      // 내 비밀번호를 바꾸면 이메일 로그인 비밀번호부터 바꾼다 (실패하면 저장하지 않음)
      if (form.password && !editingOther) await changeOwnFirebasePassword(form.password);
      await saveUser({
        ...target,
        role,
        nickname: nickname || target.nickname,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        storeName: role === 'merchant' ? form.storeName.trim() : '',
        businessNumber: role === 'merchant' ? form.businessNumber.trim() : '',
        address: role === 'merchant' ? form.address.trim() : '',
        isMonthlyPurchase: role === 'merchant' && admin ? form.isMonthly : target.isMonthlyPurchase,
        monthlyPurchaseAmount: role === 'merchant' && admin ? (form.isMonthly ? Number(form.monthlyAmount) || 0 : 0) : target.monthlyPurchaseAmount,
        assignedRegion: role === 'local' ? form.region.trim() : '',
        allowedMarkets: role === 'buyer' ? form.allowedMarkets : [],
        assignedMerchants: role === 'local' ? form.assignedMerchants : [],
        isBuyerAdmin: role === 'buyer' && admin ? form.isBuyerAdmin : role === 'buyer' ? target.isBuyerAdmin : false,
        approved: admin ? form.approved : target.approved,
        passwordHash: form.password ? await sha256(form.password) : target.passwordHash,
      });
      notify('회원정보를 저장했습니다.', 'success');
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const role = editingOther && admin ? form.role : target.role;

  return (
    <Modal
      title={editingOther ? `${target.name} 회원정보` : '내 정보'}
      subtitle={editingOther ? '관리자 권한으로 수정합니다.' : '가입 정보와 비밀번호를 바꿀 수 있습니다.'}
      icon={<UserPen className="h-5 w-5 text-indigo-400" />}
      onClose={onClose}
      z="z-[260]"
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" type="submit" form="profile-form" disabled={saving}>{saving ? '저장 중...' : '저장'}</Button></>}
    >
      <form id="profile-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="닉네임"><Input value={form.nickname} onChange={e => set('nickname', e.target.value)} maxLength={12} placeholder="닉네임 (2~12자)" /></Field>
          <Field label="회원 유형">
            <Select value={role} disabled={!(editingOther && admin)} onChange={e => set('role', e.target.value as UserRole)}>
              {(Object.keys(ROLE_LABEL) as UserRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="이름 *"><Input required value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="전화번호"><Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="이메일"><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></Field>

        {role === 'merchant' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="상호 *"><Input value={form.storeName} onChange={e => set('storeName', e.target.value)} /></Field>
              <Field label="사업자등록번호"><Input value={form.businessNumber} onChange={e => set('businessNumber', e.target.value)} /></Field>
            </div>
            <Field label="가게 주소"><Input value={form.address} onChange={e => set('address', e.target.value)} /></Field>
            {admin && (
              <div className="space-y-2">
                <Toggle checked={form.isMonthly} onChange={v => set('isMonthly', v)} label="월사입 거래처" description="월 고정 사입비를 받는 거래처는 건당 사입비를 청구하지 않습니다." />
                {form.isMonthly && <Field label="월 사입비 (원)"><Input inputMode="numeric" value={form.monthlyAmount} onChange={e => set('monthlyAmount', e.target.value.replace(/[^0-9]/g, ''))} /></Field>}
              </div>
            )}
          </>
        )}

        {role === 'local' && (
          <>
            <Field label="담당 지역 *">
              <Select value={form.region} onChange={e => set('region', e.target.value)}>
                <option value="">선택하세요</option>
                {regions.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label={`담당 거래처 (${form.assignedMerchants.length}곳)`} hint={admin ? '관리자만 지정할 수 있습니다.' : undefined}>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-2">
                {merchants.length === 0 && <span className="text-xs text-gray-500">등록된 상인이 없습니다.</span>}
                {merchants.map(m => {
                  const on = form.assignedMerchants.includes(m.username);
                  const others = takenMerchants.get(m.username);
                  return (
                    <button key={m.username} type="button" disabled={!admin} onClick={() => toggleIn('assignedMerchants', m.username)}
                      className={cx('rounded-lg border px-2 py-1 text-xs font-bold', on ? 'border-violet-400 bg-violet-700 text-white' : 'border-gray-700 bg-gray-900 text-gray-300')}>
                      {m.storeName || m.name}{others && <span className="ml-1 text-[10px] opacity-70">({others.join(',')})</span>}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {role === 'buyer' && (
          <>
            {admin && <Toggle checked={form.isBuyerAdmin} onChange={v => set('isBuyerAdmin', v)} label="서브관리자" description="전체 주문 보기, 회원 관리(사입삼촌), 데이터 관리 권한" />}
            <Field label={`담당 건물 (${form.allowedMarkets.length}곳)`} hint={canEditMarkets ? '괄호 안은 같은 건물을 맡은 다른 사입삼촌' : '담당 건물은 관리자가 지정합니다.'}>
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-2">
                {buildingOptions.map(m => {
                  const on = form.allowedMarkets.includes(m);
                  const others = takenMarkets.get(m);
                  return (
                    <button key={m} type="button" disabled={!canEditMarkets} onClick={() => toggleIn('allowedMarkets', m)}
                      className={cx('rounded-lg border px-2 py-1 text-xs font-bold', on ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-gray-700 bg-gray-900 text-gray-300')}>
                      {m}{others && <span className="ml-1 text-[10px] opacity-70">({others.join(',')})</span>}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {admin && editingOther && <Toggle checked={form.approved} onChange={v => set('approved', v)} label="가입 승인" description="승인된 회원만 로그인할 수 있습니다." />}

        <Field label="새 비밀번호" hint="바꿀 때만 입력 (6자 이상)">
          <PasswordInput autoComplete="new-password" value={form.password} onChange={v => set('password', v)} placeholder="바꿀 때만 입력" />
        </Field>
      </form>
    </Modal>
  );
}
