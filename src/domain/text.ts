const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** '대표상호' → 'ㄷㅍㅅㅎ' (한글이 아닌 글자는 그대로) */
export function initials(value: string): string {
  return Array.from(String(value ?? ''))
    .map(ch => {
      const code = ch.charCodeAt(0) - 0xac00;
      return code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch;
    })
    .join('');
}

/** 공백 제거 + 소문자. 상호 비교의 기준 키. */
export function compact(value: string | undefined | null): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 검색어가 대상 문자열에 포함되는지 (공백 무시, 대소문자 무시).
 * 검색어가 초성으로만 되어 있으면(ㅎㅊㅋ) 초성 검색을 한다.
 */
export function fuzzyIncludes(target: string | undefined | null, query: string): boolean {
  const q = compact(query);
  if (!q) return true;
  const t = compact(target);
  if (!t) return false;
  if (t.includes(q)) return true;
  return /^[ㄱ-ㅎ]+$/.test(q) && initials(t).includes(q);
}

export function sortKo(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true });
}

export function uniqueSorted(values: Iterable<string | undefined | null>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) set.add(s);
  }
  return [...set].sort(sortKo);
}
