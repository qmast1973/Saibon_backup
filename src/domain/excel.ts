import type { Transaction } from '../types';
import { normalizeDate, toDateStr } from './dates';
import { formatRoom, parseAmount } from './format';
import { normalizeMarket } from './markets';
import { hasStatus, RETURN_STATUSES } from './ledger';

/** 엑셀에서 읽어 온, 아직 저장 전인 행 */
export interface ExcelRow {
  date: string;
  sourceManager: string;
  region: string;
  store: string;
  market: string;
  floor: string;
  room: string;
  expense: number;
  income: number;
  status: string;
  remark: string;
  itemCount?: number; // 물건 갯수 (엑셀에 '수량' 열이 있을 때만)
}

const HEADER_KEYWORDS = ['날짜', '일자', '일시', '담당', '삼촌', '상호', '거래처', '매장', '건물', '시장', '상가', '층', '호수', '호', '대납', '지출', '금액', '입금', '수금', '상태', '비고', '메모', '수량', '갯수'];

const COLUMNS: Record<keyof ExcelRow, { keys: string[]; fallback: number }> = {
  date: { keys: ['날짜', '일자', '주문일', '일시', 'date'], fallback: 0 },
  sourceManager: { keys: ['담당', '담당자', '사입삼촌', '삼촌', '사입자', 'manager'], fallback: 1 },
  region: { keys: ['지역', '소속', '지점', 'region'], fallback: 2 },
  store: { keys: ['상호', '소매상호', '거래처', '매장', '가게', '소매', 'store'], fallback: 3 },
  market: { keys: ['건물', '시장', '상가', '건물명', '도매', 'market'], fallback: 4 },
  floor: { keys: ['층', '층수', 'floor'], fallback: 5 },
  room: { keys: ['호수', '호', 'room'], fallback: 6 },
  expense: { keys: ['대납', '대납금', '대납액', '지출', '사입금', 'expense'], fallback: 7 },
  income: { keys: ['입금', '입금액', '수금', '수금액', 'income'], fallback: -1 },
  itemCount: { keys: ['수량', '물건갯수', '물건수', '갯수', '개수', 'itemcount'], fallback: -1 },
  status: { keys: ['상태', '완료', '진행', '구분', '완료여부', 'status'], fallback: -1 },
  remark: { keys: ['비고', '메모', '특이사항', '내용', 'remark', 'memo'], fallback: -1 },
};

/**
 * 엑셀 원장을 읽는다. 첫 10줄 중 제목 키워드가 가장 많은 줄을 머리글로 보고,
 * 날짜·담당·지역이 비어 있는 행은 윗 행 값을 이어받는다 (병합 셀 대응).
 */
export async function readLedgerExcel(file: File, defaultDate: string): Promise<{ rows: ExcelRow[]; convertedFromWon: boolean }> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheetName = workbook.SheetNames.find(n => /주문|사입|원장|내역|Sheet1|data/i.test(n)) || workbook.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (grid.length < 2) return { rows: [], convertedFromWon: false };

  let headerRow = 0;
  let best = -1;
  grid.slice(0, 10).forEach((row, i) => {
    const hits = (row || []).filter(cell => HEADER_KEYWORDS.some(k => String(cell ?? '').replace(/\s+/g, '').includes(k))).length;
    if (hits > best) [best, headerRow] = [hits, i];
  });

  const headers = (grid[headerRow] || []).map(h => String(h ?? '').replace(/\s+/g, '').toLowerCase());
  const col = {} as Record<keyof ExcelRow, number>;
  for (const [field, spec] of Object.entries(COLUMNS) as [keyof ExcelRow, (typeof COLUMNS)[keyof ExcelRow]][]) {
    const found = spec.keys.map(k => headers.findIndex(h => h.includes(k.toLowerCase()))).find(i => i >= 0);
    col[field] = found ?? spec.fallback;
  }
  const cell = (row: unknown[], field: keyof ExcelRow) => (col[field] >= 0 ? row[col[field]] : '');

  let date = defaultDate;
  let manager = '';
  let region = '합성동';
  const rows: ExcelRow[] = [];
  for (const row of grid.slice(headerRow + 1)) {
    const d = normalizeDate(cell(row, 'date'), '');
    if (d) date = d;
    const m = String(cell(row, 'sourceManager') ?? '').trim();
    if (m) manager = m;
    const r = String(cell(row, 'region') ?? '').trim();
    if (r) region = r;

    const parsed: ExcelRow = {
      date,
      sourceManager: manager,
      region,
      store: String(cell(row, 'store') ?? '').trim(),
      market: normalizeMarket(String(cell(row, 'market') ?? '')),
      floor: String(cell(row, 'floor') ?? '').trim(),
      room: String(cell(row, 'room') ?? '').trim(),
      expense: parseAmount(cell(row, 'expense')),
      income: parseAmount(cell(row, 'income')),
      status: String(cell(row, 'status') ?? '').trim(),
      remark: String(cell(row, 'remark') ?? '').trim(),
      itemCount: col.itemCount >= 0 && String(cell(row, 'itemCount') ?? '').trim() !== '' ? parseAmount(cell(row, 'itemCount')) : undefined,
    };
    if (parsed.store || parsed.expense || parsed.income) rows.push(parsed);
  }
  return toThousandUnit(rows);
}

/**
 * 앱은 금액을 천원 단위로 저장한다 (35 = 35,000원). 엑셀에 원 단위(35000)로 적혀 있으면 그대로 넣을 때 1000배로 불어나므로,
 * 0이 아닌 금액의 80% 이상이 1,000 이상이면 원 단위 파일로 보고 1000으로 나눈다. (이 앱이 내보낸 엑셀도 원 단위)
 */
export function toThousandUnit<T extends { expense?: number; income?: number }>(rows: T[]): { rows: T[]; convertedFromWon: boolean } {
  const amounts = rows.flatMap(r => [Number(r.expense) || 0, Number(r.income) || 0]).filter(v => v !== 0).map(Math.abs);
  const won = amounts.length > 0 && amounts.filter(v => v >= 1000).length / amounts.length >= 0.8;
  if (!won) return { rows, convertedFromWon: false };
  const div = (v: number | undefined) => Math.round(((Number(v) || 0) / 1000) * 1000) / 1000;
  return { rows: rows.map(r => ({ ...r, expense: div(r.expense), income: div(r.income) })), convertedFromWon: true };
}

export const isReceivableRow = (r: ExcelRow) => [r.market, r.status, r.remark].some(v => v.includes('미수금'));

export function excelRowToTransaction(r: ExcelRow, role: string): Omit<Transaction, 'id'> & { id: string } {
  const date = normalizeDate(r.date);
  return {
    id: '',
    date,
    store: r.store,
    market: normalizeMarket(r.market, r.room),
    floor: r.floor,
    room: formatRoom(r.room),
    manager: r.sourceManager,
    region: r.region || '합성동',
    expense: r.expense,
    income: r.income,
    itemCount: r.itemCount,
    status: r.status,
    remark: r.remark,
    recordType: isReceivableRow(r) ? 'receivable' : 'order',
    actualManager: role === 'buyer' ? r.sourceManager : '',
    assignedManager: role === 'buyer' ? r.sourceManager : '',
    localManager: role === 'local' ? r.sourceManager : '',
    orderAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

// 엑셀 라이브러리는 커서 실제로 쓸 때만 내려받는다
const loadXlsx = () => import('xlsx');

async function download(rows: Record<string, unknown>[], sheet: string, filename: string) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/** 전체 장부 내보내기 (금액은 원 단위로 환산) */
export function exportLedger(list: Transaction[]) {
  return download(
    list.map(t => ({
      날짜: t.date, 담당자: t.manager, 지역: t.region, 상호: t.store, 건물명: t.market, 층: t.floor, 호수: t.room,
      대납금: (t.expense || 0) * 1000, 입금액: (t.income || 0) * 1000, 상태: t.status || '', 비고: t.remark || '',
    })),
    '사입원장',
    `사입ON_정산장부_${toDateStr(new Date())}.xlsx`,
  );
}

/** 사입삼촌 화면: 선택한 날짜 처리 결과 */
export function exportWorkday(list: Transaction[], date: string, fallbackManager: string) {
  return download(
    list.map(t => ({
      날짜: t.date || date,
      담당자: t.actualManager || t.assignedManager || t.manager || fallbackManager,
      지역: t.region || '',
      소매상호: t.store || '',
      도매건물: t.market || '',
      층: t.floor || '',
      호수: formatRoom(t.room),
      수량: Number(t.itemCount ?? 0),
      대납금: (t.expense || 0) * 1000,
      입금액: (t.income || 0) * 1000,
      처리상태: hasStatus(t) ? t.status : '미완료',
      반품여부: t.isReturn || RETURN_STATUSES.has(String(t.status || '')) ? 'Y' : 'N',
      처리비고: t.processingRemark || '',
      비고: t.remark || '',
    })),
    `${date}_사입데이터`,
    `사입ON_${date}_사입데이터.xlsx`,
  );
}
