import { useState, type ReactNode } from 'react';
import { AlertTriangle, Database, Download, FileSpreadsheet, Layers, Upload } from 'lucide-react';
import type { GroupRule, Transaction } from '../types';
import type { Nav } from '../App';
import { deleteAllPosts } from '../data/board';
import { deleteAllGroupRules } from '../data/groupRules';
import { clearAllCaches } from '../data/localCache';
import { deleteAllOrders, deleteOrders, fetchAllOrders, measureStorage, type StorageUsage } from '../data/orders';
import { deleteNonAdminUsers } from '../data/users';
import { isAdmin } from '../domain/access';
import { toDateStr } from '../domain/dates';
import { formatMoney } from '../domain/format';
import { exportLedger, readLedgerExcel, toThousandUnit, type ExcelRow } from '../domain/excel';
import { dedupeTransactions, defaultItemCount, hasStatus, isOrder } from '../domain/ledger';
import { useApp } from '../state/AppContext';
import { Button, ConfirmDialog, FileButton, Modal } from '../components/ui';
import { IS_DEMO } from '../data/firebase';
import { ExcelImportModal } from './ExcelImportModal';

const BACKUP_FORMAT = 'SAIPON_FULL_BACKUP';

function Section({ title, description, children, danger }: { title: string; description: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <section className={danger ? 'rounded-xl border border-rose-900 bg-rose-950/30 p-3' : 'rounded-xl border border-gray-800 bg-gray-950 p-3'}>
      <h4 className={danger ? 'text-sm font-bold text-rose-300' : 'text-sm font-bold text-gray-100'}>{title}</h4>
      <p className="mb-2.5 mt-0.5 text-[11px] leading-relaxed text-gray-400">{description}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const LIMIT_BYTES = 1024 ** 3;
const fmtSize = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

function StorageMeter({ usage }: { usage: StorageUsage }) {
  const pct = (usage.totalBytes / LIMIT_BYTES) * 100;
  const tone = pct >= 80 ? 'bg-rose-500' : pct >= 50 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="w-full space-y-1.5 rounded-xl bg-gray-950 p-3 text-xs">
      <p className="font-black text-gray-100">{fmtSize(usage.totalBytes)} / 1GB ({pct < 0.1 ? '0.1% 미만' : `${pct.toFixed(1)}%`})</p>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-800"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(1, pct))}%` }} /></div>
      <p className="text-gray-400">주문 {usage.orderCount.toLocaleString()}건 · {usage.dayCount}일치{usage.firstDate && ` (${usage.firstDate} ~ ${usage.lastDate})`} · 주문 {fmtSize(usage.ordersBytes)}</p>
      <p className="text-gray-500">{pct >= 80 ? '한도에 가까워졌습니다. 유료 플랜(Blaze) 전환을 준비하세요.' : pct >= 50 ? '절반을 넘었습니다. 가끔 다시 확인하세요.' : '여유가 충분합니다.'} 다운로드(월 10GB)는 Firebase 콘솔 사용량 화면에서 봅니다.</p>
    </div>
  );
}

export function DataModal({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const { user, users, orders, rules, saveOrders, saveRules, replaceOrdersLocal, notify } = useApp();
  const admin = isAdmin(user);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => Promise<void> } | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [excelRows, setExcelRows] = useState<ExcelRow[] | null>(null);
  // 미리보기(데모)는 서버에 접속하지 않으므로 화면에 있는 주문으로 대신한다
  const loadAll = (label = '') =>
    IS_DEMO ? Promise.resolve({ orders, empties: [] }) : fetchAllOrders(label ? (done, total) => setBusy(`${label} (${done}/${total}개월)`) : undefined);

  const task = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(`${label} 실패: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const onExcelFile = (file: File) =>
    task('엑셀 읽기', async () => {
      const { rows, convertedFromWon } = await readLedgerExcel(file, nav.date);
      if (convertedFromWon) notify('엑셀 금액이 원 단위로 보여 천원 단위로 바꿔 읽었습니다 (35000 → 35,000원). 다음 화면에서 금액이 맞는지 확인하세요.', 'info');
      if (rows.length === 0) throw new Error('가져올 데이터 행이 없습니다. 열 제목(날짜, 상호, 건물, 층, 호수, 대납 등)을 확인해주세요.');
      setExcelRows(rows);
    });

  const checkStorage = () =>
    task('저장 공간 확인', async () => {
      setUsage(await measureStorage((done, total) => setBusy(`저장 공간 확인 (${done}/${total}개월)`)));
    });

  const exportExcel = () =>
    task('엑셀 내보내기', async () => {
      const { orders: all } = await loadAll('엑셀 내보내기').catch(() => ({ orders }));
      if (all.length === 0) throw new Error('내보낼 데이터가 없습니다.');
      await exportLedger(all);
    });

  const backup = () =>
    task('백업', async () => {
      const { orders: all } = await loadAll('백업');
      const payload = {
        format: BACKUP_FORMAT,
        version: 3,
        exportedAt: new Date().toISOString(),
        orders: all,
        rules,
        // 비밀번호 해시는 백업 파일에 넣지 않는다
        users: users.map(({ passwordHash: _omit, ...rest }) => rest),
      };
      download(`사입ON_백업_${toDateStr(new Date())}.json`, JSON.stringify(payload, null, 2));
      notify(`주문 ${all.length}건, 대표거래처 ${rules.length}건을 백업했습니다.`, 'success');
    });

  const onRestoreFile = (file: File) =>
    task('복원 파일 읽기', async () => {
      const payload = JSON.parse(await file.text());
      const rawList: Transaction[] = payload.orders || payload.transactions;
      if (!Array.isArray(rawList)) throw new Error('사입ON 백업 파일이 아닙니다.');
      // 원 단위(35000)로 기록된 예전 백업이면 천원 단위(35)로 바꿔 복원한다
      const { rows: list, convertedFromWon } = toThousandUnit(rawList);
      if (convertedFromWon) notify('백업 금액이 원 단위로 보여 천원 단위로 바꿔 읽었습니다 (35000 → 35,000원).', 'info');
      const backupRules: GroupRule[] | undefined = Array.isArray(payload.rules) ? payload.rules : undefined;
      setConfirm({
        title: 'DB 복원',
        message: `백업 파일의 주문 ${list.length}건${backupRules ? `과 대표거래처 ${backupRules.length}건` : ''}을 서버에 다시 씁니다.\n같은 주문은 백업 내용으로 덮어쓰고, 백업 이후 새로 생긴 주문은 그대로 둡니다.`,
        label: '복원',
        run: async () => {
          await saveOrders(list.filter(t => t && (t.store || t.expense || t.income)));
          if (backupRules) await saveRules(backupRules);
          notify('복원을 마쳤습니다.', 'success');
        },
      });
    });

  const dedupe = () =>
    task('중복 정리', async () => {
      const { orders: all, empties } = await loadAll('중복 정리');
      const { removed } = dedupeTransactions(all);
      const targets = [...removed, ...empties];
      if (targets.length === 0) {
        notify('정리할 중복 데이터가 없습니다.', 'success');
        return;
      }
      setConfirm({
        title: '중복 정리',
        message: `완전히 같은 주문 ${removed.length}건과 빈 기록 ${empties.length}건을 삭제합니다.\n(같은 날·같은 상호·같은 매장 중 비고/금액 정보가 많은 1건만 남깁니다)`,
        label: `${targets.length}건 삭제`,
        run: async () => {
          await deleteOrders(targets);
          const removedIds = new Set(removed.map(t => t.id));
          replaceOrdersLocal(orders.filter(t => !removedIds.has(t.id)));
          notify(`${targets.length}건을 정리했습니다.`, 'success');
        },
      });
    });

  // 원 단위(35000)로 잘못 들어간 금액을 천원 단위(35)로 바로잡는다. 1,000 이상(= 100만원 이상) 금액만 대상.
  const fixUnits = () =>
    task('금액 단위 확인', async () => {
      const { orders: all } = await loadAll('금액 단위 확인');
      const targets = all.filter(t => Math.abs(Number(t.expense) || 0) >= 1000 || Math.abs(Number(t.income) || 0) >= 1000);
      if (targets.length === 0) {
        notify('원 단위로 들어간 금액이 없습니다.', 'success');
        return;
      }
      const sample = targets.slice(0, 3).map(t => `${t.store} ${formatMoney(Number(t.expense) || Number(t.income) || 0)} → ${formatMoney((Number(t.expense) || Number(t.income) || 0) / 1000)}`).join('\n');
      setConfirm({
        title: '금액 단위 바로잡기',
        message: `금액이 1,000(천원 단위, 100만원) 이상인 기록 ${targets.length}건을 1000으로 나눕니다.\n예) 35000 → 35 (35,000원)\n\n${sample}\n\n실제로 100만원 이상인 주문이 섞여 있으면 먼저 백업을 받고 진행하세요.`,
        label: `${targets.length}건 바로잡기`,
        run: async () => {
          const div = (v: unknown) => Math.round(((Number(v) || 0) / 1000) * 1000) / 1000;
          await saveOrders(targets.map(t => ({
            ...t,
            expense: Math.abs(Number(t.expense) || 0) >= 1000 ? div(t.expense) : t.expense,
            income: Math.abs(Number(t.income) || 0) >= 1000 ? div(t.income) : t.income,
          })));
          notify(`${targets.length}건의 금액을 천원 단위로 바로잡았습니다.`, 'success');
        },
      });
    });

  // 상태는 있는데 물건 갯수가 비어 있는 옛 기록(엑셀로 가져온 것 등)에 주문처리 버튼과 같은 규칙으로 갯수를 채운다. 실제 갯수가 아닌 추정치.
  const fillCounts = () =>
    task('갯수 확인', async () => {
      const { orders: all } = await loadAll('갯수 확인');
      const targets = all.filter(t => isOrder(t) && hasStatus(t) && !(Number(t.itemCount) > 0) && defaultItemCount(t.status, t.itemCount) > 0);
      if (targets.length === 0) {
        notify('갯수를 채울 기록이 없습니다.', 'success');
        return;
      }
      setConfirm({
        title: '상태 기준 갯수 채우기',
        message: `처리 상태는 있는데 물건 갯수가 비어 있는 주문 ${targets.length}건에 갯수 1을 넣습니다.\n(주문찾기 · 샘플 · 미송(찾기) · 교환 · 반송 · 교환/매입 → 1, 올미송 · 반품만 · 매입처리 · 주문없음 · 물건없음은 0 그대로)\n\n실제 갯수가 아니라 추정치입니다. 2개 이상이었던 주문은 주문처리에서 직접 고치세요.`,
        label: `${targets.length}건 채우기`,
        run: async () => {
          await saveOrders(targets.map(t => ({ ...t, itemCount: defaultItemCount(t.status, t.itemCount) })));
          notify(`${targets.length}건의 갯수를 채웠습니다.`, 'success');
        },
      });
    });

  const resetData = (withUsers: boolean) =>
    setConfirm({
      title: withUsers ? '전체 초기화' : '장부 초기화',
      message: withUsers
        ? '모든 주문 · 수금 · 대표거래처 · 게시판과 관리자를 제외한 모든 회원을 영구 삭제합니다.\n되돌릴 수 없습니다. 먼저 백업하세요.'
        : '모든 주문 · 수금 기록과 대표거래처 묶음을 영구 삭제합니다. (회원은 유지)\n되돌릴 수 없습니다. 먼저 백업하세요.',
      label: '영구 삭제',
      run: async () => {
        await deleteAllOrders();
        await deleteAllGroupRules();
        if (withUsers) {
          await deleteNonAdminUsers(users);
          await deleteAllPosts();
        }
        await clearAllCaches();
        replaceOrdersLocal([]);
        notify('초기화를 마쳤습니다.', 'success');
      },
    });

  return (
    <Modal title="데이터 관리" icon={<Database className="h-5 w-5 text-indigo-400" />} onClose={onClose} z="z-[220]">
      <div className="space-y-3">
        {busy && <p className="rounded-xl bg-indigo-950 p-2.5 text-center text-xs font-bold text-indigo-200">{busy} 진행 중...</p>}

        <Section title="엑셀" description="엑셀 원장을 날짜 · 담당자 확인 후 가져오거나, 전체 장부를 엑셀로 내려받습니다.">
          <FileButton tone="success" disabled={!!busy} accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onFile={onExcelFile}><FileSpreadsheet className="h-4 w-4" />엑셀 가져오기</FileButton>
          <Button disabled={!!busy} onClick={exportExcel}><Download className="h-4 w-4" />엑셀 내보내기</Button>
        </Section>

        <Section title="백업 · 복원" description="서버의 전체 주문(90일 이전 포함)과 대표거래처를 JSON 파일로 저장하고, 필요할 때 되돌립니다.">
          <Button tone="primary" disabled={!!busy} onClick={backup}><Download className="h-4 w-4" />백업 파일 받기</Button>
          <FileButton disabled={!!busy} accept="application/json,.json" onFile={onRestoreFile}><Upload className="h-4 w-4" />백업에서 복원</FileButton>
        </Section>

        <Section title="중복 정리" description="엑셀을 여러 번 올리는 등으로 완전히 같은 주문이 여러 개 생긴 경우, 1건만 남기고 정리합니다.">
          <Button tone="warning" disabled={!!busy} onClick={dedupe}><Layers className="h-4 w-4" />중복 데이터 찾기</Button>
        </Section>

        {admin && (
          <Section title="저장 공간 (관리자)" description="서버에 저장된 데이터 크기를 대략 계산합니다. 무료 플랜 한도는 1GB이며, 넘기 전에 유료 플랜(Blaze)으로 바꾸세요.">
            <Button disabled={!!busy} onClick={checkStorage}><Database className="h-4 w-4" />저장 공간 확인</Button>
            {usage && <StorageMeter usage={usage} />}
          </Section>
        )}

        {admin && (
          <Section title="상태 기준 갯수 채우기 (관리자)" description="상태는 있는데 물건 갯수가 비어 있는 옛 기록에 주문처리 버튼과 같은 규칙으로 갯수를 넣습니다. 실제 갯수가 아닌 추정치입니다.">
            <Button tone="warning" disabled={!!busy} onClick={fillCounts}><Layers className="h-4 w-4" />갯수 빈 기록 채우기</Button>
          </Section>
        )}

        {admin && (
          <Section title="금액 단위 바로잡기 (관리자)" description="엑셀 · 백업을 가져오다 금액이 1000배로 들어간 경우(35,000원이 35,000,000원으로 보임) 1,000 이상 금액을 1000으로 나눕니다.">
            <Button tone="warning" disabled={!!busy} onClick={fixUnits}><Layers className="h-4 w-4" />원 단위 금액 찾기</Button>
          </Section>
        )}

        {admin && (
          <Section danger title="초기화 (관리자)" description={<><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-400" />실사용 시작 전에만 쓰세요. 모든 기기의 데이터가 지워집니다.</>}>
            <Button tone="danger" disabled={!!busy} onClick={() => resetData(false)}>장부 초기화</Button>
            <Button tone="danger" disabled={!!busy} onClick={() => resetData(true)}>회원까지 전체 초기화</Button>
          </Section>
        )}
      </div>

      {excelRows && <ExcelImportModal rows={excelRows} nav={nav} onClose={() => setExcelRows(null)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            task(c.title, c.run);
          }}
        />
      )}
    </Modal>
  );
}
