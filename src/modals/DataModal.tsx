import { useState, type ReactNode } from 'react';
import { AlertTriangle, Database, Download, FileSpreadsheet, Layers, Upload } from 'lucide-react';
import type { GroupRule, Transaction } from '../types';
import type { Nav } from '../App';
import { deleteAllPosts } from '../data/board';
import { deleteAllGroupRules } from '../data/groupRules';
import { clearAllCaches } from '../data/localCache';
import { deleteAllOrders, deleteOrders, fetchAllOrders } from '../data/orders';
import { deleteNonAdminUsers } from '../data/users';
import { isAdmin } from '../domain/access';
import { toDateStr } from '../domain/dates';
import { exportLedger, readLedgerExcel, type ExcelRow } from '../domain/excel';
import { dedupeTransactions } from '../domain/ledger';
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

export function DataModal({ nav, onClose }: { nav: Nav; onClose: () => void }) {
  const { user, users, orders, rules, saveOrders, saveRules, replaceOrdersLocal, notify } = useApp();
  const admin = isAdmin(user);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => Promise<void> } | null>(null);
  const [excelRows, setExcelRows] = useState<ExcelRow[] | null>(null);
  // 미리보기(데모)는 서버에 접속하지 않으므로 화면에 있는 주문으로 대신한다
  const loadAll = () => (IS_DEMO ? Promise.resolve({ orders, empties: [] }) : fetchAllOrders());

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
      const rows = await readLedgerExcel(file, nav.date);
      if (rows.length === 0) throw new Error('가져올 데이터 행이 없습니다. 열 제목(날짜, 상호, 건물, 층, 호수, 대납 등)을 확인해주세요.');
      setExcelRows(rows);
    });

  const exportExcel = () =>
    task('엑셀 내보내기', async () => {
      const { orders: all } = await loadAll().catch(() => ({ orders }));
      if (all.length === 0) throw new Error('내보낼 데이터가 없습니다.');
      await exportLedger(all);
    });

  const backup = () =>
    task('백업', async () => {
      const { orders: all } = await loadAll();
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
      const list: Transaction[] = payload.orders || payload.transactions;
      if (!Array.isArray(list)) throw new Error('사입ON 백업 파일이 아닙니다.');
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
      const { orders: all, empties } = await loadAll();
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
