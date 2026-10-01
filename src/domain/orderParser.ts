import { matchMarketToken, resolveDByRoom } from './markets';
import { formatRoom } from './format';

export interface ParsedOrder {
  id: string;
  rawText: string;
  retailStore: string; // 소매 상호 (주문한 가게)
  wholesaleStore: string; // 도매처 상호
  market: string;
  floor: string;
  room: string;
  remark: string;
  confidence: 'high' | 'medium' | 'low';
}

const UNKNOWN_STORE = '상호 미지정';
const DECOR = '[\\[★■▶◆*●📍📌🏷️🏢🏪\\s]';
const STORE_LABEL = '(?:소매명|소매상호|소매점|소매처|소매|상호명|상호|고객사|매장명)';

const withHo = (room: string) => (room && !room.endsWith('호') && /^\d+$/.test(room) ? `${room}호` : room);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 알림톡 머릿글·바닥글, 링크, 안내 문구 등 주문이 아닌 줄 */
function isNoiseLine(line: string): boolean {
  return (
    line.includes('상호/건물명/층/호수') ||
    line.startsWith('===') ||
    line.startsWith('---') ||
    /https?:\/\//.test(line) ||
    /사입\s*요청서\s*도착/.test(line) ||
    /\d+개중\s*\d+번째\s*주문서/.test(line) ||
    /문의사항|카카오채널|연락\s*부탁드려요|고객센터|상세\s*주문서\s*확인/.test(line) ||
    /이형식도\s*되게|할수있어/.test(line)
  );
}

/**
 * 층/호수 패턴: 3-12, 3/12, 3층 12호, B1 5호, 지하1층 7호, 7F 45, 3층 C-12, B2-15호, C동
 */
export function parseFloorAndRoom(text: string): { floor: string; room: string; matchedText: string } | null {
  // '지1', 'B1' 은 단어 첫머리일 때만 지하층으로 본다 ('바지 2장'의 '지 2'를 지하2층으로 오인하지 않도록)
  const basement = text.match(
    /(?:^|[^가-힣A-Za-z])(?:지하\s*(\d+)|지\s*(\d+)|B\s*(\d+)|b\s*(\d+))(?:(?:\s*층|\s*F|\s*f)[\s\-/.호~]*|[\s\-/.호~]*)([가-힣A-Za-z0-9\s\-~]+?)(?:\s*호|$|\s+(?=[가-힣A-Za-z]))/i,
  );
  if (basement && (basement[1] || basement[2] || basement[3] || basement[4])) {
    const n = basement[1] || basement[2] || basement[3] || basement[4];
    return { floor: `지하${n}층`, room: withHo((basement[5] || '').trim()), matchedText: basement[0] };
  }

  const standard = text.match(
    /(\d+)(?:(?:\s*층|\s*F|\s*f)[\s\-/.호~]*|[-/.])([가-힣A-Za-z0-9\s\-~]+?)(?:\s*호|$|\s+(?=[가-힣A-Za-z]))/,
  );
  if (standard) return { floor: `${standard[1]}층`, room: withHo(standard[2].trim()), matchedText: standard[0] };

  const onlyFloor = text.match(/(\d+)\s*(?:층|F|f)/i);
  if (onlyFloor) return { floor: `${onlyFloor[1]}층`, room: '', matchedText: onlyFloor[0] };

  const dong = text.match(/([가-힣A-Za-z]+)\s*동(?:\s|$)/);
  if (dong) return { floor: `${dong[1]}동`, room: '', matchedText: dong[0].trim() };

  return null;
}

/** 토큰 배열에서 건물명을 찾아 제거하고, 붙어 있던 나머지(예: 디오트4층G16 → 4층G16)는 남긴다. */
function extractMarket(tokens: string[]): string {
  for (let i = 0; i < tokens.length; i++) {
    const match = matchMarketToken(tokens[i]);
    if (!match) continue;
    const rest = tokens[i].replace(new RegExp(escapeRe(match.matchedAlias), 'i'), ' ').trim();
    tokens.splice(i, 1, ...(rest ? rest.split(/\s+/) : []));
    return match.canonical;
  }
  return '';
}

/** 슬래시(/) 또는 쉼표 3개 이상으로 나뉜 정형 주문 한 줄 */
function parseDelimited(line: string) {
  const delimiter = line.includes('/') ? '/' : ',';
  const parts = line.split(delimiter).map(p => p.trim());
  if (parts.length < 2) return null;

  let store: string, market: string, floor: string, room: string, remark: string;
  const firstAsMarket = matchMarketToken(parts[0]);
  if (firstAsMarket) {
    // 건물 / 층 호수 / 도매상호 / 비고   또는   건물 / 층 / 호수 / 도매상호 / 비고
    market = firstAsMarket.canonical;
    const fr = parseFloorAndRoom(parts[1] || '');
    if (fr?.room) {
      [floor, room, store, remark] = [fr.floor, fr.room, parts[2] || UNKNOWN_STORE, parts.slice(3).join(' / ')];
    } else {
      [floor, room, store, remark] = [parts[1] || '', parts[2] || '', parts[3] || UNKNOWN_STORE, parts.slice(4).join(' / ')];
    }
  } else {
    // 도매상호 / 건물 / 층 / 호수 / 비고
    store = parts[0] || UNKNOWN_STORE;
    market = matchMarketToken(parts[1] || '')?.canonical || parts[1] || '';
    const fr = parseFloorAndRoom(parts[2] || '');
    if (fr?.room) {
      [floor, room, remark] = [fr.floor, fr.room, parts.slice(3).join(' / ')];
    } else {
      [floor, room, remark] = [parts[2] || '', parts[3] || '', parts.slice(4).join(' / ')];
    }
  }

  if (floor && !room) {
    const fr = parseFloorAndRoom(floor);
    if (fr?.room) [floor, room] = [fr.floor, fr.room];
  }
  return { store, market, floor, room, remark };
}

/** 슬래시 없는 자연어 카톡 문장: "디오트 3층 12호 초록상회 바지 2장", "청 B1-5 상호A" */
function parseFreeform(line: string, rawLine: string) {
  let tokens = line.split(/\s+/);
  let market = '';

  // "APM 플레이스" 처럼 두 토큰짜리 건물명은 완전 일치만 인정
  for (let i = 0; i < tokens.length - 1; i++) {
    const match = matchMarketToken(`${tokens[i]} ${tokens[i + 1]}`, true);
    if (match) {
      market = match.canonical;
      tokens.splice(i, 2);
      break;
    }
  }
  if (!market) market = extractMarket(tokens);

  let floor = '';
  let room = '';
  const rest = tokens.join(' ');
  const fr = parseFloorAndRoom(rest);
  if (fr) {
    [floor, room] = [fr.floor, fr.room];
    tokens = rest.replace(fr.matchedText, ' ').trim().split(/\s+/).filter(Boolean);
  } else if (market && tokens.length > 0 && /^[A-Za-z가-힣]-?\d{1,4}호?$/.test(tokens[0])) {
    // "디 f10", "디오트 가-10" 처럼 건물 뒤에 호수 코드만 오는 경우
    room = tokens.shift()!;
  }

  // 층/호수를 지운 뒤에야 보이는 한 글자 영문 약어(D 등)를 다시 찾는다
  if (!market) market = extractMarket(tokens);

  let store = '';
  let remark = '';
  if (tokens.length > 0) {
    if (market === '신발상가' && floor.endsWith('동') && !room) {
      store = UNKNOWN_STORE;
      remark = tokens.join(' ');
    } else {
      store = tokens.shift()!;
      remark = tokens.join(' ');
    }
  }

  // 원문에 '디오트'/'디자이너'를 풀네임으로 쓰지 않고 '디'/'d'로 쓴 경우에만 호수로 다시 판정
  if ((market === '디오트' || market === '디자이너클럽') && room) {
    const usedShortD = !/디오트|디자이너/i.test(rawLine) && /디|d/i.test(rawLine.replace(/\s+/g, ''));
    const byRoom = usedShortD ? resolveDByRoom(room) : null;
    if (byRoom) market = byRoom;
  }

  if (!market && !(floor && room)) return null;
  const confidence: ParsedOrder['confidence'] = market && (floor || room) ? 'high' : market ? 'medium' : 'low';
  return { store: store || UNKNOWN_STORE, market, floor, room, remark, confidence };
}

/** 텍스트 맨 아래 한 줄짜리 상호(바이어명)가 있는 형식 */
function findFooterStore(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].trim();
    if (!text || text.startsWith('===') || text.startsWith('---') || text.includes('http')) continue;
    if (matchMarketToken(text) || parseFloorAndRoom(text)) return '';
    if (text.length <= 15 && !/주문|샘플|교환|미송|반품|신상/.test(text)) {
      return text.replace(new RegExp(`^${DECOR}+|[\\]★■▶◆*●\\s]+$`, 'g'), '').trim();
    }
    return '';
  }
  return '';
}

let idSeq = 0;
const newId = () => `parsed_${Date.now()}_${++idSeq}`;

/**
 * 카카오톡 / 문자 / 신상마켓 요청서 텍스트를 주문 목록으로 분석한다.
 * defaultStore: 상인이 직접 입력할 때의 소매 상호.
 */
export function parseOrderText(inputText: string, defaultStore = ''): ParsedOrder[] {
  if (!inputText.trim()) return [];
  const lines = inputText.split('\n');
  const results: ParsedOrder[] = [];
  const footerStore = findFooterStore(lines);
  let retailStore = footerStore || defaultStore.trim();
  let isFirstLine = true;

  for (const original of lines) {
    const rawLine = original.trim();
    if (!rawLine || isNoiseLine(rawLine)) continue;

    const arrival = rawLine.match(/^([가-힣A-Za-z0-9_\s]{2,25}?)(?:으로|로)부터\s*사입\s*요청서/);
    if (arrival) {
      if (!matchMarketToken(arrival[1].trim())) retailStore = arrival[1].trim();
      continue;
    }

    const header = rawLine.match(new RegExp(`^${DECOR}*${STORE_LABEL}\\s*[:：]?\\s*([가-힣A-Za-z0-9_\\s]{2,25})(?:[\\]★■▶◆*]|\\s*$)`));
    if (header && !matchMarketToken(header[1].trim())) {
      retailStore = header[1].trim();
      continue;
    }

    // 첫 줄이 상호명 하나뿐이면 소매 상호로 사용
    if (isFirstLine) {
      isFirstLine = false;
      if (!rawLine.includes('/') && !/도착|요청서|주문서|신상마켓|카카오|안내|공지|주문내용/.test(rawLine)) {
        const name = rawLine
          .replace(new RegExp(`^${DECOR}+|[\\]★■▶◆*●\\s]+$`, 'g'), '')
          .replace(new RegExp(`^${STORE_LABEL}(?:\\s*[:：]\\s*|\\s+)`), '')
          .trim();
        const [first, ...rest] = name.split(/\s+/);
        const looksLikeOrder = rest.length > 0 && !!matchMarketToken(first, true) && /\d/.test(rest.join(' '));
        if (name && !looksLikeOrder && !matchMarketToken(name)) {
          retailStore = name;
          continue;
        }
      }
    }

    const line = rawLine
      .replace(new RegExp(`^${DECOR}*(?:주문내용|주문상세|주문목록|주문서|주문)\\s*[:：~-]?\\s*`, 'i'), '')
      .trim()
      .replace(/^(\d+[.)]|[①-⑳]|[-*•])\s*/, '')
      .trim();

    const delimited = line.includes('/') || line.split(',').length >= 3 ? parseDelimited(line) : null;
    const parsed = delimited ? { ...delimited, confidence: 'high' as const } : parseFreeform(line, rawLine);

    if (parsed) {
      results.push({
        id: newId(),
        rawText: rawLine,
        retailStore,
        wholesaleStore: parsed.store.trim(),
        market: parsed.market.trim(),
        floor: parsed.floor.trim(),
        room: parsed.room.trim(),
        remark: parsed.remark.trim(),
        confidence: parsed.confidence,
      });
      continue;
    }

    // 주문으로 인식되지 않은 짧은 줄("샘플건", 넘어간 메모)은 바로 윗 주문의 비고로 붙인다
    const last = results[results.length - 1];
    if (last && rawLine !== footerStore && (rawLine.length < 25 || /주문|샘플|교환|미송|반품|신상/.test(rawLine))) {
      last.remark = last.remark ? `${last.remark} / ${rawLine}` : rawLine;
      last.rawText += `\n${rawLine}`;
    }
  }
  return results;
}

/** 호수 뒤에 도매처 상호를 괄호로 붙인다: ("12", "상호B") → "12호 (상호B)" */
export function composeRoomWithWholesale(room: string, wholesaleStore: string): string {
  const wholesale = wholesaleStore.trim();
  if (!wholesale || wholesale === UNKNOWN_STORE || wholesale === '~') return formatRoom(room);
  const unwrapped = /^\(.*\)$/.test(wholesale) ? wholesale.slice(1, -1) : wholesale;
  const cleanWholesale = unwrapped.replace(/호+$/, '').trim();
  if (!cleanWholesale) return formatRoom(room);
  let cleanRoom = room.replace(/\s*\([^)]*\)/g, '').trim();
  if (cleanRoom && !cleanRoom.endsWith('호') && /^[a-zA-Z0-9\-.]+$/.test(cleanRoom)) cleanRoom = `${cleanRoom}호`;
  return cleanRoom ? `${cleanRoom} (${cleanWholesale})` : `(${cleanWholesale})`;
}
