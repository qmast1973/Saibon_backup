import { initials } from './text';

/** 건물 목록 기본값 (Firestore settings/markets_v2 가 비어 있을 때) */
export const DEFAULT_MARKETS = [
  '===== 동대문 =====', 'APM', 'APM 럭스', 'APM 플레이스', '팀204', '디자이너', '누죤', '골든상가', '샤넬 마네킹', '대일 마네킹',
  '에소르', '누누', '유어스', '벨포스트', '퀸즈', '광희', '제일평화', '맥스타일', '신평화', '남평화', '동평화',
  '아트', '더블유 스튜디오', '해양', '동원', '테크노', '청평화', '신발상가', '디오트', '픽대지', '상상', '자판',
  '===== 남대문 =====', '세로나', '포키', '원', '시티', '페인트', '부르뎅', '마마', '웅이', '화이트', '탑',
  '크레용', '키즈', '팀엔드',
];

/** 건물 목록에서 선택할 수 없는 구분선 */
export const MARKET_SEPARATOR_RE = /^=+.*=+$/;

/** 금액 전용 구분 (건물이 아님) */
export const DEPOSIT_MARKET = '입금';
export const RECEIVABLE_MARKET = '미수금';
export const NON_BUILDING_MARKETS = new Set([DEPOSIT_MARKET, RECEIVABLE_MARKET, '결산', '회식비', '식대', '식비', '경비']);

/** 저장 시 사용하는 정식 건물명으로 바꾸는 은어/약어 표 */
const ALIASES: Record<string, string> = {
  a: 'APM', apm: 'APM',
  럭스: 'APM럭스', apm럭스: 'APM럭스', apmluxe: 'APM럭스',
  플레이스: 'APM플레이스', apm플레이스: 'APM플레이스', apmplace: 'APM플레이스',
  d: '디자이너', 디자이너: '디자이너', 디자이너클럽: '디자이너', 디클: '디자이너',
  뉴존: '누죤', 누죤: '누죤', 누: '누죤', n: '누죤',
  ddp: '유어스', 유: '유어스', 유어스: '유어스', ddp패션몰: '유어스',
  팀: '팀204', '204': '팀204', 팀204: '팀204',
  제평: '제일평화', 제: '제일평화', j: '제일평화', jp: '제일평화', 제일평화: '제일평화',
  맥스: '맥스타일', 맥: '맥스타일', 맥스타일: '맥스타일',
  신평: '신평화', 신: '신평화', 신평화: '신평화',
  남평: '남평화', 남: '남평화', nph: '남평화', 남평화: '남평화',
  퀸즈: '퀸즈스퀘어', 퀸: '퀸즈스퀘어', 퀸즈스퀘어: '퀸즈스퀘어',
  광: '광희', 광희: '광희', 광희패션몰: '광희',
  벨포: '벨포스트', 벨포스트: '벨포스트',
  아트: '아트프라자', 아트프라자: '아트프라자',
  더블유: '스튜디오 더블유', w: '스튜디오 더블유', 스튜디오: '스튜디오 더블유', 스튜디오더블유: '스튜디오 더블유',
  스튜디오w: '스튜디오 더블유', studiow: '스튜디오 더블유',
  혜: '혜양', 혜양: '혜양',
  테: '테크노', 테크노: '테크노',
  동원: '동원프라자', dwp: '동원프라자', 동원프라자: '동원프라자',
  동평: '동평화', dph: '동평화', 동평화: '동평화',
  청평: '청평화', 청: '청평화', cph: '청평화', 청평화: '청평화',
  디오: '디오트', 디: '디오트', 디오트: '디오트',
  픽대지: '픽대지',
  신발: '신발상가', 신발상가: '신발상가',
};

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * '디' / 'd' 는 호수로 구분한다 (AGENTS.md 규칙).
 *  - 호수에 알파벳·한글이 있으면 디오트 (f10, 가-10)
 *  - 숫자/하이픈뿐이면 디자이너 (1-10, 15)
 */
export function resolveDByRoom(room: string): '디오트' | '디자이너' | null {
  const clean = String(room ?? '').replace(/호/g, '').trim();
  if (!clean) return null;
  if (/[a-zA-Z가-힣]/.test(clean)) return '디오트';
  if (/^[0-9\-.]+$/.test(clean)) return '디자이너';
  return null;
}

/**
 * 입력된 건물명(은어·약어·초성 포함)을 정식 명칭으로 바꾼다.
 * 이 결과가 DB에 저장되므로 출력 값이 바뀌면 기존 데이터와 매칭이 깨진다. 수정 시 주의.
 */
export function normalizeMarket(value: string | undefined | null, room = ''): string {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const raw = squash(input);

  if (raw === '디' || raw === 'd' || raw === '디오트' || raw === '디자이너') {
    const byRoom = resolveDByRoom(room);
    if (byRoom) return byRoom;
  }

  if (ALIASES[raw]) return ALIASES[raw];

  for (const m of DEFAULT_MARKETS) if (squash(m) === raw) return m;
  for (const m of DEFAULT_MARKETS) if (squash(initials(m)) === raw) return m;
  for (const m of DEFAULT_MARKETS) {
    if (squash(initials(m)).startsWith(raw) || squash(m).startsWith(raw)) return m;
  }

  return input.replace(/\s+/g, ' ').replace(/[A-Za-z]+/g, w => w.toUpperCase());
}

export const isDepositMarket = (market: string | undefined) => normalizeMarket(market) === DEPOSIT_MARKET;
export const isReceivableMarket = (market: string | undefined) => normalizeMarket(market) === RECEIVABLE_MARKET;

/** 실제 사입 주문인지 (입금 / 미수금 행이 아닌지) */
export function isOrderMarket(market: string | undefined): boolean {
  const m = normalizeMarket(market);
  return m !== DEPOSIT_MARKET && m !== RECEIVABLE_MARKET;
}

// ---------------------------------------------------------------------------
// 텍스트 파서용 사전: 문장 안에서 건물명을 찾아낼 때 사용 (정식명은 normalizeMarket 으로 재정규화)
// ---------------------------------------------------------------------------

export const MARKET_DICTIONARY: { canonical: string; aliases: string[] }[] = [
  { canonical: '디오트', aliases: ['디오트', '디오', '디', 'THEOT', 'THE OT', 'DEOT'] },
  { canonical: 'APM플레이스', aliases: ['APM플레이스', 'APM 플레이스', '에이피엠플레이스', '에플', '에이플', '플레이스', 'APM PLACE', 'APM P', 'APMP', '플스'] },
  { canonical: 'APM럭스', aliases: ['APM럭스', 'APM 럭스', 'APM LUXE', 'APMLUXE', '럭스'] },
  { canonical: 'APM', aliases: ['APM', '에이피엠', '에펨'] },
  { canonical: '청평화', aliases: ['청평화', '청평', '청', 'CPH', 'CHEONGPYEONGHWA'] },
  { canonical: '퀸즈스퀘어', aliases: ['퀸즈스퀘어', '퀸즈', '퀸', 'QUEENS', 'QUEENSSQUARE'] },
  { canonical: '디자이너클럽', aliases: ['디자이너클럽', '디자이너', '디클', 'DC', 'DESIGNER', 'D'] },
  { canonical: '벨포스트', aliases: ['벨포스트', '벨포', '벨', 'BELPOST'] },
  { canonical: '누죤', aliases: ['누죤', '누존', '누', 'NUZZON', 'NUZON'] },
  { canonical: '테크노', aliases: ['테크노', '테크', '테', 'TECHNO'] },
  { canonical: '동평화', aliases: ['동평화', '동평', '동', 'DONGPYEONGHWA', 'DPH'] },
  { canonical: '남평화', aliases: ['남평화', '남평', '남', 'NAMPYEONGHWA', 'NPH'] },
  { canonical: '신평화', aliases: ['신평화', '신평', '신', 'SHINPYEONGHWA', 'SPH'] },
  { canonical: '제일평화', aliases: ['제일평화', '제평', '제', 'JEIL', 'JPH', 'J'] },
  { canonical: '유어스', aliases: ['유어스', 'UUS', 'DDP패션몰', 'DDP', 'DDP FASHION'] },
  { canonical: '스튜디오W', aliases: ['스튜디오W', '스튜디오더블유', '스튜디오', 'SW', 'STUDIO W'] },
  { canonical: '아트프라자', aliases: ['아트프라자', '아트', 'ART'] },
  { canonical: '광희패션몰', aliases: ['광희패션몰', '광희', '광'] },
  { canonical: '엘리시움', aliases: ['엘리시움', '혜양엘리시움', '엘리', 'ELYSIUM'] },
  { canonical: '맥스타일', aliases: ['맥스타일', '맥스', 'MAX'] },
  { canonical: '평화시장', aliases: ['평화시장', '평화', '평'] },
  { canonical: '통일상가', aliases: ['통일상가', '통일', '통'] },
  { canonical: '동대문종합시장', aliases: ['동대문종합시장', '동대문종합', '종합시장'] },
  { canonical: '신발상가', aliases: ['신발상가', '청계천신발상가', '동대문신발상가', '신발'] },
  { canonical: '미수금', aliases: ['미수금', '미수'] },
  { canonical: '입금', aliases: ['입금', '송금', '이체'] },
];

const SORTED_DICTIONARY = MARKET_DICTIONARY.map(e => ({
  canonical: e.canonical,
  aliases: [...e.aliases].sort((a, b) => b.length - a.length),
}));

/**
 * 토큰이 건물명인지 판별한다. exactOnly=false 이면 부분 일치도 허용하되,
 * 한 글자 한글 약어('청','신','남')는 '요청','신청' 같은 일반 단어 오인을 막기 위해 부분 일치에서 제외한다.
 */
export function matchMarketToken(token: string, exactOnly = false): { canonical: string; matchedAlias: string } | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const candidates = [trimmed.toUpperCase()];
  const paren = trimmed.match(/^([^(]+)\(([^)]+)\)$/);
  if (paren) candidates.push(paren[1].trim().toUpperCase(), paren[2].trim().toUpperCase());
  const withoutParen = trimmed.replace(/\([^)]*\)/g, '').trim().toUpperCase();
  if (withoutParen && !candidates.includes(withoutParen)) candidates.push(withoutParen);

  for (const entry of SORTED_DICTIONARY) {
    for (const alias of entry.aliases) {
      if (candidates.includes(alias.toUpperCase())) return { canonical: entry.canonical, matchedAlias: alias };
    }
  }
  if (exactOnly) return null;

  for (const entry of SORTED_DICTIONARY) {
    for (const alias of entry.aliases) {
      if (alias.length < 2) {
        if (/^[A-Za-z]$/.test(alias)) {
          const re = new RegExp(`(^|[^A-Za-z])${alias}(?![A-Za-z])`, 'i');
          if (candidates.some(c => re.test(c))) return { canonical: entry.canonical, matchedAlias: alias };
        }
        continue;
      }
      const upper = alias.toUpperCase();
      if (candidates.some(c => c.includes(upper))) return { canonical: entry.canonical, matchedAlias: alias };
    }
  }
  return null;
}
