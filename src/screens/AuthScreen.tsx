import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ShieldPlus } from 'lucide-react';
import type { UserRole } from '../types';
import { sendPasswordReset, signIn, signUp } from '../data/users';
import * as cache from '../data/localCache';
import { uniqueSorted } from '../domain/text';
import { useApp } from '../state/AppContext';
import { AdminCreateModal } from '../modals/AdminCreateModal';
import { FontSizePicker } from '../components/FontSizePicker';
import { APP_VERSION_LABEL } from '../lib/version';
import { Button, Field, Input, LoginIdInput, PasswordInput, Select, cx } from '../components/ui';
import { Logo } from '../components/Logo';

type Mode = 'login' | 'register' | 'reset';
type Message = { text: string; error: boolean } | null;

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={cx('rounded-xl border p-3 text-center text-xs font-bold', message.error ? 'border-rose-800 bg-rose-950/60 text-rose-200' : 'border-emerald-800 bg-emerald-950/60 text-emerald-200')}>
      {message.text}
    </p>
  );
}

export function AuthScreen() {
  const { users, orders, login, usersAccess } = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [showAdminCreate, setShowAdminCreate] = useState(false);

  // 로그인
  const [loginId, setLoginId] = useState(() => (cache.getSavedId().includes('@') ? cache.getSavedId() : ''));
  const [password, setPassword] = useState('');
  const [saveId, setSaveId] = useState(() => !!cache.getSavedId());
  const [autoLogin, setAutoLoginState] = useState(cache.getAutoLogin);

  // 회원가입
  const [reg, setReg] = useState({
    email: '', nickname: '', role: 'merchant' as UserRole, storeName: '', businessNumber: '', name: '', region: '', address: '', phone: '', password: '', password2: '',
  });
  const setRegField = (key: keyof typeof reg) => (v: string) => setReg(prev => ({ ...prev, [key]: v }));

  // 비밀번호 재설정
  const [resetEmail, setResetEmail] = useState('');

  const regions = useMemo(() => uniqueSorted(['합성동', ...orders.map(o => o.region)]), [orders]);
  // 서버에서 회원 목록을 실제로 읽었고 관리자가 없을 때만 '최초 관리자' 버튼을 보인다
  const canCreateFirstAdmin = usersAccess === 'ok' && !users.some(u => u.role === 'admin');

  const switchMode = (m: Mode) => {
    setMode(m);
    setMessage(null);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : '처리하지 못했습니다.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      cache.setSavedId(saveId ? loginId.trim() : '');
      cache.setAutoLogin(autoLogin);
      const user = await signIn(loginId, password, users);
      if (user.role !== 'admin' && !user.approved) {
        throw new Error('가입 승인 대기 중인 계정입니다. 관리자 승인 후 이용할 수 있습니다.');
      }
      login(user);
    });
  };

  const handleRegister = (e: FormEvent) => {
    e.preventDefault();
    const fail = (text: string) => setMessage({ text, error: true });
    if (!reg.email.includes('@')) return fail('유효한 이메일 주소를 입력해주세요.');
    if (!reg.name.trim()) return fail('이름을 입력해주세요.');
    if (!reg.phone.trim()) return fail('연락받을 전화번호를 입력해주세요.');
    if (reg.role === 'merchant' && !reg.storeName.trim()) return fail('상호를 입력해주세요.');
    if (reg.role === 'merchant' && !reg.address.trim()) return fail('가게 주소를 입력해주세요.');
    if (reg.role === 'local' && !reg.region.trim()) return fail('담당 지역을 선택해주세요.');
    if (reg.password.length < 6) return fail('비밀번호는 6자 이상이어야 합니다.');
    if (reg.password !== reg.password2) return fail('비밀번호가 일치하지 않습니다.');

    run(async () => {
      const created = await signUp(
        {
          email: reg.email,
          password: reg.password,
          nickname: reg.nickname,
          name: reg.name,
          phone: reg.phone,
          role: reg.role,
          storeName: reg.storeName,
          businessNumber: reg.businessNumber,
          address: reg.address,
          assignedRegion: reg.region,
        },
        users,
      );
      setLoginId(created.email || reg.email);
      setPassword('');
      setMode('login');
      setMessage({ text: `회원가입이 완료되었습니다. (닉네임: ${created.nickname || reg.nickname})\n관리자 승인 후 로그인해주세요.`, error: false });
    });
  };

  const handleReset = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await sendPasswordReset(resetEmail);
      setMessage({ text: `${resetEmail} 로 가입된 계정이 있으면 재설정 메일이 갑니다. 몇 분 안에 받은편지함(또는 스팸함)을 확인해주세요. 메일이 안 오면 그 이메일로 가입된 계정이 없는 것입니다.`, error: false });
    });
  };

  return (
    <div className="auth-screen flex min-h-dvh items-start justify-center overflow-y-auto bg-gray-950 p-3 sm:items-center sm:p-4">
      <div className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex justify-center bg-indigo-950 px-4 py-5">
          <Logo className="h-36 sm:h-48" />
        </div>

        <div className="p-4 sm:p-6">
          {mode === 'reset' ? (
            <div className="mb-4 flex items-center justify-between border-b border-gray-800 pb-3">
              <button type="button" onClick={() => switchMode('login')} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-300">
                <ArrowLeft className="h-4 w-4" /> 로그인으로
              </button>
              <span className="text-xs font-bold text-gray-300">비밀번호 재설정</span>
            </div>
          ) : (
            <div className="mb-5 flex rounded-xl border border-gray-800 bg-gray-950 p-1">
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={cx('flex-1 rounded-lg py-2 text-xs font-bold transition', mode === m ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200')}
                >
                  {m === 'login' ? '로그인' : '회원가입'}
                </button>
              ))}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              <Field label="이메일" hint="가입할 때 쓴 이메일 주소로 로그인합니다.">
                <LoginIdInput email required autoComplete="email" value={loginId} onChange={setLoginId} placeholder="name@example.com" />
              </Field>
              <Field label="비밀번호">
                <PasswordInput required value={password} onChange={setPassword} placeholder="비밀번호를 입력하세요" autoComplete="current-password" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-xs text-gray-300">
                <div className="flex gap-4 whitespace-nowrap">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={saveId} onChange={e => setSaveId(e.target.checked)} className="accent-indigo-500" /> 이메일 저장
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={autoLogin} onChange={e => setAutoLoginState(e.target.checked)} className="accent-indigo-500" /> 자동 로그인
                  </label>
                </div>
                <button type="button" onClick={() => switchMode('reset')} className="min-h-[44px] whitespace-nowrap font-bold text-indigo-300 underline">
                  비밀번호 찾기
                </button>
              </div>
              <Button type="submit" tone="primary" size="lg" disabled={busy} className="w-full">
                {busy ? '확인 중...' : '로그인'}
              </Button>
              <Notice message={message} />
              {canCreateFirstAdmin && (
                <button type="button" onClick={() => setShowAdminCreate(true)} className="flex w-full items-center justify-center gap-1.5 pt-2 text-xs font-bold text-gray-400 hover:text-gray-200">
                  <ShieldPlus className="h-4 w-4" /> 최초 관리자 계정 만들기
                </button>
              )}
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <Field label="회원 유형 *">
                <div className="grid grid-cols-3 gap-1.5">
                  {([['merchant', '상인(소매)'], ['local', '지방삼촌'], ['buyer', '사입삼촌']] as const).map(([role, label]) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRegField('role')(role)}
                      className={cx('rounded-xl border py-2 text-xs font-bold', reg.role === role ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-gray-700 bg-gray-950 text-gray-300')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="이메일 *">
                <Input type="email" required autoComplete="email" value={reg.email} onChange={e => setRegField('email')(e.target.value.trim())} placeholder="name@example.com" />
              </Field>
              <Field label="닉네임 *" hint="앱에서 나를 구분하는 이름입니다. 2~12자, 한글 · 영문 · 숫자.">
                <Input required minLength={2} maxLength={12} value={reg.nickname} onChange={e => setRegField('nickname')(e.target.value)} placeholder="닉네임" autoComplete="nickname" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="이름 / 대표자명 *">
                  <Input required value={reg.name} onChange={e => setRegField('name')(e.target.value)} placeholder="이름" />
                </Field>
                <Field label="전화번호 *">
                  <Input type="tel" required value={reg.phone} onChange={e => setRegField('phone')(e.target.value)} placeholder="010-0000-0000" />
                </Field>
              </div>
              {reg.role === 'merchant' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="상호명 *">
                      <Input required value={reg.storeName} onChange={e => setRegField('storeName')(e.target.value)} placeholder="예시상호" />
                    </Field>
                    <Field label="사업자등록번호">
                      <Input value={reg.businessNumber} onChange={e => setRegField('businessNumber')(e.target.value)} placeholder="000-00-00000" />
                    </Field>
                  </div>
                  <Field label="가게 주소 *">
                    <Input required autoComplete="street-address" value={reg.address} onChange={e => setRegField('address')(e.target.value)} placeholder="배송받을 매장 주소" />
                  </Field>
                </>
              )}
              {reg.role === 'local' && (
                <Field label="담당 지역 *">
                  <Select required value={reg.region} onChange={e => setRegField('region')(e.target.value)}>
                    <option value="">담당 지역을 선택하세요</option>
                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="비밀번호 *">
                  <PasswordInput required value={reg.password} onChange={setRegField('password')} placeholder="6자 이상" autoComplete="new-password" />
                </Field>
                <Field label="비밀번호 확인 *">
                  <PasswordInput required value={reg.password2} onChange={setRegField('password2')} placeholder="한 번 더" autoComplete="new-password" />
                </Field>
              </div>
              <Button type="submit" tone="primary" size="lg" disabled={busy} className="w-full">
                {busy ? '가입 처리 중...' : '회원가입 신청'}
              </Button>
              <Notice message={message} />
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-3.5">
              <p className="text-xs leading-relaxed text-gray-400">
                가입할 때 쓴 이메일로 재설정 링크를 보냅니다. 메일이 오지 않으면 관리자에게 임시 비밀번호 발급을 요청하세요.
              </p>
              <Field label="이메일">
                <Input type="email" required value={resetEmail} onChange={e => setResetEmail(e.target.value.trim())} placeholder="name@example.com" />
              </Field>
              <Button type="submit" tone="primary" size="lg" disabled={busy} className="w-full">
                {busy ? '보내는 중...' : '재설정 메일 보내기'}
              </Button>
              <Notice message={message} />
            </form>
          )}
          <div className="mt-5">
            <FontSizePicker compact />
          </div>
          <p className="mt-3 text-center text-[11px] text-gray-500">사입ON {APP_VERSION_LABEL}</p>
        </div>
      </div>
      {showAdminCreate && <AdminCreateModal onClose={() => setShowAdminCreate(false)} />}
    </div>
  );
}
