import { get, ref, set } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { DEFAULT_MARKETS } from '../domain/markets';
import { firestore, IS_DEMO, rtdb, withTimeout, write } from './firebase';

/** 건물 목록은 RTDB settings/markets 에 저장한다 (주문과 같은 무료 기본 DB) */
const marketsRef = () => ref(rtdb, 'settings/markets');

const toList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : Object.values((v || {}) as object)).map(x => String(x ?? '').trim()).filter(Boolean);

/**
 * 예전 앱이 건물 목록을 Firestore(settings/markets_v2)에 저장해 두었다.
 * RTDB 에 아직 목록이 없을 때 한 번만 읽어 와서 RTDB 로 옮긴다. (Firestore 가 막혀 있으면 조용히 건너뛴다)
 */
async function importLegacyMarkets(): Promise<string[] | null> {
  try {
    const snap = await withTimeout(getDoc(doc(firestore, 'settings', 'markets_v2')), 6000, '예전 건물 목록 조회');
    const list = snap.exists() ? toList(snap.data().list) : [];
    if (list.length === 0) return null;
    await write(set(marketsRef(), list), '건물 목록 옮기기');
    return list;
  } catch (e) {
    console.warn('예전 건물 목록을 가져오지 못했습니다:', e);
    return null;
  }
}

export async function fetchMarkets(): Promise<string[]> {
  if (IS_DEMO) return [...DEFAULT_MARKETS];
  try {
    const list = toList((await withTimeout(get(marketsRef()), 8000, '건물 목록 조회')).val());
    if (list.length > 0) return list;
    const legacy = await importLegacyMarkets();
    if (legacy) return legacy;
  } catch (e) {
    console.warn('건물 목록을 불러오지 못해 기본값을 사용합니다:', e);
  }
  return [...DEFAULT_MARKETS];
}

export async function saveMarkets(markets: string[]): Promise<void> {
  if (IS_DEMO) return;
  await write(set(marketsRef(), markets), '건물 목록 저장');
}
