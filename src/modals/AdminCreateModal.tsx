import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { createEmailAccountForOther, emailKey, fetchUsers, freeKey, isPermissionDenied, nicknameTaken, sha256, userKey } from '../data/users';
import { useApp } from '../state/AppContext';
import { Button, Field, Input, LoginIdInput, Modal, PasswordInput } from '../components/ui';

/**
 * 관리자 계정 추가.
 * 관리자가 하나도 없으면 최초 관리자를 만들고, 이미 있으면 로그인한 관리자이거나 기존 관리자 인증이 필요하다.
 */
export function AdminCreateModal({ onClose }: { onClose: () => void }) {
  const { user: me, users: knownUsers, usersAccess, saveUser, notify } = useApp();
  const [form, setForm] = useState({ authId: '', authPw: '', name: '', email: '', phone: '', id: '', pw: '', pw2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));
  const loggedInAdmin = me?.role === 'admin';
  // 서버 회원 목록에 관리자가 하나도 없으면 최초 관리자이므로 기존 관리자 인증을 묻지 않는다
  const firstAdmin = usersAccess === 'ok' && !knownUsers.some(u => u.role === 'admin');
  const needAuth = !loggedInAdmin && !firstAdmin;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const nickname = form.id.trim();
    if (!form.name.trim() || !nickname) return setError('이름과 닉네임을 입력해주세요.');
    if (nickname.length < 2 || nickname.length > 12) return setError('닉네임은 2~12자로 입력해주세요.');
    if (form.pw.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.');
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('서버 접속에 이메일 로그인이 필요해서 실제 이메일 주소를 꼭 입력해야 합니다.');
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
        const admin = admins.find(u => userKey(u.username) === userKey(form.authId) || String(u.email || '').toLowerCase() === userKey(form.authId));
        if (!admin || admin.passwordHash !== (await sha256(form.authPw))) throw new Error('기존 관리자 이메일 또는 비밀번호가 올바르지 않습니다.');
      }
      if (nicknameTaken(users, nickname)) throw new Error('이미 사용 중인 닉네임입니다.');
      const username = freeKey(emailKey(email), users); // 내부 고유키 (이메일 앞부분)

      // 이메일 로그인 계정부터 만든다 (지금 로그인한 관리자 세션은 유지)
      const uid = await createEmailAccountForOther(email, form.pw);
      await saveUser({
        uid,
        username,
        nickname,
        name: form.name.trim(),
        email,
        phone: form.phone.trim(),
        passwordHash: await sha256(form.pw),
        role: 'admin',
        approved: true,
        createdAt: new Date().toISOString(),
        createdBy: loggedInAdmin ? me!.username : form.authId || 'initial_setup',
      });
      notify(`관리자 계정(${nickname})을 만들었습니다.`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자 계정을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="관리자 계정 추가" icon={<ShieldCheck className="h-5 w-5 text-rose-400" />} onClose={onClose} size="sm" z="z-[300]"
      subtitle={loggedInAdmin ? '새 관리자 계정을 만듭니다.' : firstAdmin ? '아직 관리자가 없어서 최초 관리자를 만듭니다.' : '관리자가 이미 있으면 기존 관리자 인증이 필요합니다.'}
    >
      <form onSubmit={submit} className="space-y-3">
        {needAuth && (
          <div className="space-y-2 rounded-xl border border-gray-800 bg-gray-950 p-3">
            <p className="text-[11px] text-gray-400">기존 관리자 인증</p>
            <LoginIdInput email value={form.authId} onChange={set('authId')} placeholder="기존 관리자 이메일" autoComplete="off" />
            <PasswordInput value={form.authPw} onChange={set('authPw')} placeholder="기존 관리자 비밀번호" autoComplete="off" />
          </div>
        )}
        <Field label="이름 *"><Input required value={form.name} onChange={e => set('name')(e.target.value)} placeholder="관리자 이름" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="이메일 *"><Input type="email" required value={form.email} onChange={e => set('email')(e.target.value)} placeholder="로그인에 쓸 이메일" /></Field>
          <Field label="전화번호"><Input type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)} placeholder="선택" /></Field>
        </div>
        <Field label="닉네임 * (2~12자)"><Input required minLength={2} maxLength={12} value={form.id} onChange={e => set('id')(e.target.value)} autoComplete="off" /></Field>
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
