import { doc, getDoc, setDoc } from 'firebase/firestore';
import { DEFAULT_MARKETS } from '../domain/markets';
import { firestore, IS_DEMO, withTimeout, write } from './firebase';

const marketsDoc = () => doc(firestore, 'settings', 'markets_v2');

/** 건물 목록 (Firestore settings/markets_v2) */
export async function fetchMarkets(): Promise<string[]> {
  if (IS_DEMO) return [...DEFAULT_MARKETS];
  try {
    const snap = await withTimeout(getDoc(marketsDoc()), 8000, '건물 목록 조회');
    const list = snap.exists() ? snap.data().list : null;
    if (Array.isArray(list) && list.length > 0) return list.map(String);
  } catch (e) {
    console.warn('건물 목록을 불러오지 못해 기본값을 사용합니다:', e);
  }
  return [...DEFAULT_MARKETS];
}

export async function saveMarkets(markets: string[]): Promise<void> {
  if (IS_DEMO) return;
  await write(setDoc(marketsDoc(), { list: markets, updatedAt: new Date().toISOString() }, { merge: true }), '건물 목록 저장');
}
