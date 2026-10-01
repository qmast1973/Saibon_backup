const pad = (n: number) => String(n).padStart(2, '0');

export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 영업일: 새벽 7시 이전은 전날 장사로 친다. */
export function getBusinessDate(base = new Date()): string {
  const d = new Date(base);
  if (d.getHours() < 7) d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

/** 새벽 2시 ~ 아침 7시에는 주문 접수를 받지 않는다 (관리자 제외). */
export function isOrderTimeBlocked(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 2 && h < 7;
}
export const ORDER_BLOCKED_MESSAGE = '주문 가능 시간이 아닙니다.\n(주문 가능 시간: 아침 7시 ~ 새벽 2시)';

/**
 * 다양한 날짜 표기를 YYYY-MM-DD 로 맞춘다.
 * 엑셀 일련번호(45424), 2024.5.12, 24/05/12, 20240512, 5월 12일 등.
 */
export function normalizeDate(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (val instanceof Date) return isNaN(val.getTime()) ? fallback : toDateStr(val);

  const asNum = Number(val);
  if (String(val).trim().length >= 4 && asNum > 20000 && asNum < 80000) {
    const d = new Date(Math.floor(asNum - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const s = String(val).trim();
  if (!s) return fallback;

  let m = s.match(/^(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{2})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
  if (m) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-./\s월]\s*(\d{1,2})/);
  if (m) return `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s;
}

const holidayCache = new Map<number, Record<string, string>>();

/**
 * 한국 공휴일 (KST 기준). 연휴는 모든 날에 "설날 (~12일)" 처럼 끝나는 날을 붙인다.
 * 공휴일 라이브러리는 용량이 커서 처음 필요할 때 불러온다.
 */
export async function getKoreanHolidays(year: number): Promise<Record<string, string>> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const { default: Holidays } = await import('date-holidays');
  const days: { dateStr: string; name: string; time: number }[] = [];
  const hd = new Holidays('KR', { languages: ['ko'] });
  for (const h of hd.getHolidays(year)) {
    if (h.type !== 'public') continue;
    const end = new Date(h.end);
    for (const cur = new Date(h.start); cur < end; cur.setDate(cur.getDate() + 1)) {
      const kst = new Date(cur.getTime() + 9 * 3600 * 1000);
      const y = kst.getUTCFullYear(), mo = kst.getUTCMonth(), d = kst.getUTCDate();
      days.push({ dateStr: `${y}-${pad(mo + 1)}-${pad(d)}`, name: h.name, time: Date.UTC(y, mo, d) });
    }
  }
  days.sort((a, b) => a.time - b.time);

  // 연속된 날을 묶고, 같은 날 중복이면 뒤의 것(대체공휴일 등)을 쓴다
  const groups: (typeof days)[] = [];
  for (const day of days) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const diff = last ? (day.time - last.time) / 86400000 : Infinity;
    if (diff === 0) group[group.length - 1] = day;
    else if (diff === 1) group.push(day);
    else groups.push([day]);
  }

  const map: Record<string, string> = {};
  for (const group of groups) {
    if (group.length === 1) {
      map[group[0].dateStr] = group[0].name;
      continue;
    }
    const lastDay = Number(group[group.length - 1].dateStr.slice(8));
    for (const day of group) map[day.dateStr] = `${day.name.replace(/ \(대체공휴일\)/g, '')} (~${lastDay}일)`;
  }
  holidayCache.set(year, map);
  return map;
}
