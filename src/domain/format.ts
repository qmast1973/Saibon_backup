/**
 * 호수/도매처 표시 통일.
 *  "25" → "25호", "12 (어반)" → "12호 (어반)", "(어반)호" → "(어반)", "어반" → "(어반)"
 */
export function formatRoom(rawRoom: string | null | undefined): string {
  let str = String(rawRoom ?? '').trim();
  if (!str) return '';

  str = str.replace(/\)\s*호+$/g, ')');

  const paren = str.match(/^(.*?)\s*(\([^)]+\))$/);
  if (paren) {
    let roomPart = paren[1].trim();
    const storePart = paren[2].trim().replace(/^(\([^)]+?)호\)$/, '$1)');
    if (!roomPart) return storePart;
    if (!roomPart.endsWith('호') && /^[a-zA-Z0-9\-.\s]+$/.test(roomPart)) {
      roomPart = `${roomPart.replace(/\s+/g, '')}호`;
    }
    return `${roomPart} ${storePart}`;
  }

  if (str.endsWith('호')) return str;
  if (/^[a-zA-Z0-9\-.]+$/.test(str)) return `${str}호`;
  return str.startsWith('(') && str.endsWith(')') ? str : `(${str})`;
}

/** 층 비교용 키: "3층" → "3" */
export function floorKey(floor: string | null | undefined): string {
  return String(floor ?? '').replace(/층$/, '').trim();
}

/** 층 표시: "3" → "3층", "지1" → "지1층", "" → "" */
export function formatFloor(floor: string | null | undefined): string {
  const key = floorKey(floor);
  return key ? `${key}층` : '';
}

/** 건물 · 층 · 호수 한 줄 표시 */
export function formatLocation(t: { market?: string; floor?: string; room?: string }): string {
  return [t.market, formatFloor(t.floor), formatRoom(t.room)].filter(Boolean).join(' ');
}

/** 금액은 천원 단위로 저장된다: 15 → "15,000원" */
export function formatMoney(thousands: number | undefined | null): string {
  const v = Number(thousands || 0);
  if (!Number.isFinite(v) || v === 0) return '0원';
  return `${v.toLocaleString('ko-KR')},000원`;
}

/** "1,500" / "1500원" / "-3" → 숫자. 숫자가 없으면 0. */
export function parseAmount(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,000원?$/, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
