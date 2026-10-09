/**
 * 사입비 포함 여부는 '언제부터 바뀌었는지'를 날짜와 함께 기록한다.
 * 한 번 끄면 지난 날짜까지 소급되어 이미 받은 사입비가 초과 입금으로 보이는 문제를 막기 위함이다.
 */
export interface FeePolicyEntry {
  from: string; // YYYY-MM-DD (이 날짜부터 적용)
  on: boolean; // 그날부터 사입비를 받는지
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 서버에서 읽은 값을 날짜순으로 정리한다 (잘못된 항목은 버림) */
export function cleanFeePolicy(raw: unknown): FeePolicyEntry[] {
  const list = Array.isArray(raw) ? raw : Object.values((raw || {}) as object);
  return list
    .map(x => x as Partial<FeePolicyEntry> | null)
    .filter((x): x is FeePolicyEntry => !!x && typeof x.from === 'string' && DATE_RE.test(x.from) && typeof x.on === 'boolean')
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** 그 날짜에 사입비를 받는지. 기록이 없으면 받는 것(기본)이고, 가장 가까운 이전 기록을 따른다. */
export function feeOnAt(policy: FeePolicyEntry[], date: string): boolean {
  let on = true;
  for (const e of policy) {
    if (e.from <= date) on = e.on;
    else break;
  }
  return on;
}

/** from 날짜부터 on 으로 바꾼 새 기록. 같은 날짜에 이미 있으면 덮어쓰고, 앞 기록과 같은 값이 이어지면 합친다. */
export function withFeeFrom(policy: FeePolicyEntry[], from: string, on: boolean): FeePolicyEntry[] {
  const sorted = [...policy.filter(e => e.from !== from), { from, on }].sort((a, b) => a.from.localeCompare(b.from));
  const merged: FeePolicyEntry[] = [];
  let current = true; // 기록이 없을 때의 기본값은 '받음'
  for (const e of sorted) {
    if (e.on === current) continue; // 직전과 같은 값이면 필요 없는 기록
    merged.push(e);
    current = e.on;
  }
  return merged;
}
