import { useState } from 'react';
import { KeyRound, Layers, Pencil, Shield, ShieldPlus, Store, Trash2, Truck, UserCheck, Users } from 'lucide-react';
import type { User, UserRole } from '../types';
import type { Nav } from '../App';
import { deleteUser, makeTempPassword, sha256 } from '../data/users';
import { isAdmin } from '../domain/access';
import { useApp } from '../state/AppContext';
import { Badge, Button, ConfirmDialog, Modal, cx } from '../components/ui';

const CATEGORIES: { role: UserRole; title: string; icon: typeof Users }[] = [
  { role: 'merchant', title: '상인 (소매점)', icon: Store },
  { role: 'local', title: '지방삼촌', icon: Truck },
  { role: 'buyer', title: '사입삼촌', icon: UserCheck },
  { role: 'admin', title: '관리자', icon: Shield },
];

/** 회원 관리. 서브관리자는 사입삼촌만 관리한다. */
export function UsersModal({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const { user: me, users, saveUser, removeUserLocal, notify } = useApp();
  const admin = isAdmin(me);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const visible = (admin ? users : users.filter(u => u.role === 'buyer')).filter(u => !onlyPending || !u.approved);
  const pendingCount = users.filter(u => !u.approved && u.role !== 'admin').length;
  const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && notify(ok, 'success')).catch(e => notify(e instanceof Error ? e.message : '처리하지 못했습니다.', 'error'));

  const resetPassword = async (u: User) => {
    const password = makeTempPassword();
    await saveUser({ ...u, passwordHash: await sha256(password) });
    setTempPassword({ username: u.username, password });
  };

  const remove = (u: User) => {
    if (u.role === 'admin' && users.filter(x => x.role === 'admin').length <= 1) return notify('마지막 관리자 계정은 삭제할 수 없습니다.', 'error');
    setConfirmDelete(u);
  };

  return (
    <Modal
      title="회원 관리"
      subtitle="가입 승인, 권한, 담당 건물/거래처, 비밀번호 초기화"
      icon={<Users className="h-5 w-5 text-sky-400" />}
      onClose={onClose}
      size="xl"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" tone={onlyPending ? 'warning' : 'secondary'} onClick={() => setOnlyPending(!onlyPending)}>승인 대기만 ({pendingCount})</Button>
        {admin && (
          <>
            <Button size="sm" tone="violet" onClick={() => nav.open({ type: 'rules' })}><Layers className="h-3.5 w-3.5" />대표거래처 묶기</Button>
            <Button size="sm" tone="danger" onClick={() => nav.open({ type: 'adminCreate' })}><ShieldPlus className="h-3.5 w-3.5" />관리자 추가</Button>
          </>
        )}
      </div>

      <div className="space-y-4">
        {CATEGORIES.map(cat => {
          const list = visible.filter(u => u.role === cat.role).sort((a, b) => Number(a.approved) - Number(b.approved) || a.name.localeCompare(b.name, 'ko'));
          if (list.length === 0) return null;
          const Icon = cat.icon;
          return (
            <section key={cat.role}>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-200"><Icon className="h-4 w-4" />{cat.title} <span className="text-gray-500">{list.length}</span></h4>
              <div className="space-y-2">
                {list.map(u => (
                  <div key={u.username} className={cx('rounded-xl border p-3', u.approved ? 'border-gray-800 bg-gray-950' : 'border-amber-800 bg-amber-950/30')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 text-xs">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <b className="text-sm text-gray-100">{u.name}</b>
                          <span className="text-gray-500">@{u.username}</span>
                          {u.storeName && <Badge className="bg-emerald-900/60 text-emerald-200">{u.storeName}</Badge>}
                          {u.isBuyerAdmin && <Badge className="bg-indigo-900 text-indigo-200">서브관리자</Badge>}
                          {u.isMonthlyPurchase && <Badge className="bg-teal-900 text-teal-200">월사입 {(u.monthlyPurchaseAmount || 0).toLocaleString()}원</Badge>}
                          <Badge className={u.approved ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-900 text-amber-200'}>{u.approved ? '승인됨' : '승인 대기'}</Badge>
                        </p>
                        <p className="mt-1 text-gray-400">
                          {[u.phone, u.email, u.assignedRegion && `지역: ${u.assignedRegion}`, u.address && `주소: ${u.address}`].filter(Boolean).join(' · ')}
                        </p>
                        {!!u.allowedMarkets?.length && <p className="mt-0.5 text-gray-500">담당 건물: {u.allowedMarkets.join(', ')}</p>}
                        {!!u.assignedMerchants?.length && (
                          <p className="mt-0.5 text-gray-500">담당 거래처: {u.assignedMerchants.map(m => users.find(x => x.username === m)?.storeName || m).join(', ')}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {u.role !== 'admin' && (
                          <Button size="sm" tone={u.approved ? 'secondary' : 'success'} onClick={() => run(saveUser({ ...u, approved: !u.approved }), u.approved ? '승인을 취소했습니다.' : '승인했습니다.')}>
                            {u.approved ? '승인 취소' : '승인'}
                          </Button>
                        )}
                        {admin && u.role === 'buyer' && (
                          <Button size="sm" onClick={() => run(saveUser({ ...u, isBuyerAdmin: !u.isBuyerAdmin }))}>{u.isBuyerAdmin ? '서브관리자 해제' : '서브관리자 지정'}</Button>
                        )}
                        <Button size="sm" onClick={() => nav.open({ type: 'profile', username: u.username })}><Pencil className="h-3.5 w-3.5" />수정</Button>
                        <Button size="sm" onClick={() => run(resetPassword(u))}><KeyRound className="h-3.5 w-3.5" />임시 비번</Button>
                        {admin && u.username !== me?.username && (
                          <Button size="sm" tone="danger" onClick={() => remove(u)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="회원 삭제"
          message={`${confirmDelete.name} (@${confirmDelete.username}) 계정을 삭제할까요?\n주문 기록은 그대로 남습니다.`}
          confirmLabel="삭제"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const u = confirmDelete;
            setConfirmDelete(null);
            removeUserLocal(u.username);
            run(deleteUser(u.username), '회원을 삭제했습니다.');
          }}
        />
      )}
      {tempPassword && (
        <Modal title="임시 비밀번호 발급" onClose={() => setTempPassword(null)} size="sm" z="z-[400]">
          <p className="text-sm text-gray-300">아래 정보를 회원에게 전달하고, 로그인 후 내 정보에서 비밀번호를 바꾸도록 안내하세요.</p>
          <div className="mt-3 space-y-1 rounded-xl border border-gray-700 bg-gray-950 p-3 font-mono text-sm">
            <p>아이디: <b className="text-white">{tempPassword.username}</b></p>
            <p>임시 비밀번호: <b className="select-all text-amber-300">{tempPassword.password}</b></p>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
