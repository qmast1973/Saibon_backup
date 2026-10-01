import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fetchUsers, isPermissionDenied, sha256, userKey } from '../data/users';
import { sanitizeLoginId } from '../domain/keyboard';
import { useApp } from '../state/AppContext';
import { Button, Field, Input, Modal, PasswordInput } from '../components/ui';

/**
 * 관리자 계정 추가.
 * 관리자가 하나도 없으면 최초 관리자를 만들고, 이미 있으면 로그인한 관리자이거나 기존 관리자 인증이 필요하다.
 */
export function AdminCreateModal({ onClose }: { onClose: () => void }) {
  const { user: me, saveUser, notify } = useApp();
  const [form, setForm] = useState({ authId: '', authPw: '', name: '', email: '', phone: '', id: '', pw: '', pw2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));
  const loggedInAdmin = me?.role === 'admin';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const username = userKey(form.id);
    if (!form.name.trim() || !username) return setError('이름과 아이디를 입력해주세요.');
    if (!/^[a-z0-9._-]{4,}$/.test(username)) return setError('아이디는 영문/숫자 4자 이상으로 입력해주세요.');
    if (form.pw.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.');
    if (form.pw !== form.pw2) return setError('비밀번호가 일치하지 않습니다.');

    setBusy(true);
    try {
      // 화면에 남은 목록이 아니라 서버의 최신 회원 목록으로 확인한다
      const users = await fetchUsers().catch(e => {
        throw new Error(isPermissionDenied(e)
          ? '서버가 회원 정보를 보여 주지 않아 확인할 수 없습니다. 기존 관리자의 이메일 주소로 로그인한 뒤 설정 → 회원 관리에서 추가해 주세요.'
          : '회원 정보를 불러오지 못했습니다. 네트워크를 확인해주세요.');
      });
      const admins = users.filter(u => u.role === 'admin');
      if (admins.length > 0 && !loggedInAdmin) {
        const admin = admins.find(u => userKey(u.username) === userKey(form.authId));
        if (!admin || admin.passwordHash !== (await sha256(form.authPw))) throw new Error('기존 관리자 아이디 또는 비밀번호가 올바르지 않습니다.');
      }
      if (users.some(u => userKey(u.username) === username)) throw new Error('이미 사용 중인 아이디입니다.');

      await saveUser({
        username,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase() || `${username}@saipon.app`,
        phone: form.phone.trim(),
        passwordHash: await sha256(form.pw),
        role: 'admin',
        approved: true,
        createdAt: new Date().toISOString(),
        createdBy: loggedInAdmin ? me!.username : form.authId || 'initial_setup',
      });
      notify(`관리자 계정(${username})을 만들었습니다.`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자 계정을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="관리자 계정 추가" icon={<ShieldCheck className="h-5 w-5 text-rose-400" />} onClose={onClose} size="sm" z="z-[300]"
      subtitle={loggedInAdmin ? '새 관리자 계정을 만듭니다.' : '관리자가 이미 있으면 기존 관리자 인증이 필요합니다.'}
    >
      <form onSubmit={submit} className="space-y-3">
        {!loggedInAdmin && (
          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950 p-3">
            <p className="text-[11px] text-gray-400">기존 관리자 인증 (최초 생성 시에는 비워 두세요)</p>
            <Input value={form.authId} onChange={e => set('authId')(sanitizeLoginId(e.target.value))} placeholder="기존 관리자 아이디" autoComplete="off" />
            <PasswordInput value={form.authPw} onChange={set('authPw')} placeholder="기존 관리자 비밀번호" autoComplete="off" />
          </div>
        )}
        <Field label="이름 *"><Input required value={form.name} onChange={e => set('name')(e.target.value)} placeholder="관리자 이름" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="이메일"><Input type="email" value={form.email} onChange={e => set('email')(e.target.value)} placeholder="선택" /></Field>
          <Field label="전화번호"><Input type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder="선택" /></Field>
        </div>
        <Field label="아이디 * (영문/숫자 4자 이상)"><Input required value={form.id} onChange={e => set('id')(sanitizeLoginId(e.target.value).replace('@', ''))} autoComplete="off" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="비밀번호 *"><PasswordInput required value={form.pw} onChange={set('pw')} autoComplete="new-password" /></Field>
          <Field label="비밀번호 확인 *"><PasswordInput required value={form.pw2} onChange={set('pw2')} autoComplete="new-password" /></Field>
        </div>
        {error && <p className="rounded-xl border border-rose-800 bg-rose-950/60 p-2.5 text-xs font-bold text-rose-200">{error}</p>}
        <Button type="submit" tone="danger" size="lg" disabled={busy} className="w-full">{busy ? '저장 중...' : '관리자 계정 만들기'}</Button>
      </form>
    </Modal>
  );
}
