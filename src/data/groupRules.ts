import { onValue, ref, set } from 'firebase/database';
import { collection, deleteDoc, doc, getDocs, writeBatch } from 'firebase/firestore';
import type { GroupRule } from '../types';
import { firestore, IS_DEMO, rtdb, withTimeout, write } from './firebase';

/**
 * 대표거래처 규칙은 RTDB collectionGroupRules (배열) 가 기준이다.
 * 같은 DB를 쓰는 기존 앱이 Firestore collectionGroupRules 도 읽으므로 저장할 때 함께 맞춰 둔다.
 */

function cleanRule(r: Partial<GroupRule>, index: number): GroupRule | null {
  const storeName = String(r.storeName || '').trim();
  const groupName = String(r.groupName || '').trim();
  if (!storeName && !groupName) return null;
  const rule: GroupRule = {
    id: String(r.id || `group_${Date.now()}_${index}`),
    storeName,
    groupName,
    matchType: r.matchType === 'prefix' ? 'prefix' : 'exact',
    effectiveFrom: String(r.effectiveFrom || '').trim(),
    systemDefault: Boolean(r.systemDefault),
    createdAt: String(r.createdAt || new Date().toISOString()),
    note: String(r.note || '').trim(),
  };
  if (r.isMonthlyPurchase) {
    rule.isMonthlyPurchase = true;
    rule.monthlyPurchaseAmount = Number(r.monthlyPurchaseAmount) || 0;
  }
  return rule;
}

export const cleanRules = (list: unknown): GroupRule[] =>
  (Array.isArray(list) ? list : Object.values((list || {}) as object))
    .map((r, i) => (r ? cleanRule(r as Partial<GroupRule>, i) : null))
    .filter((r): r is GroupRule => r !== null);

export function subscribeGroupRules(onChange: (rules: GroupRule[]) => void, onError?: (e: Error) => void) {
  if (IS_DEMO) return () => undefined;
  return onValue(ref(rtdb, 'collectionGroupRules'), snap => onChange(cleanRules(snap.val())), e => onError?.(e));
}

async function mirrorToFirestore(rules: GroupRule[]): Promise<void> {
  const col = collection(firestore, 'collectionGroupRules');
  const batch = writeBatch(firestore);
  const existing = await withTimeout(getDocs(col), 5000, 'Firestore 조회');
  const keep = new Set(rules.map(r => r.id));
  existing.docs.forEach(d => {
    if (!keep.has(d.id)) batch.delete(d.ref);
  });
  rules.forEach(r => batch.set(doc(firestore, 'collectionGroupRules', r.id), r));
  await withTimeout(batch.commit(), 8000, 'Firestore 저장');
}

export async function saveGroupRules(rules: GroupRule[]): Promise<void> {
  if (IS_DEMO) return;
  const clean = cleanRules(rules);
  await write(set(ref(rtdb, 'collectionGroupRules'), clean), '대표거래처 저장');
  mirrorToFirestore(clean).catch(e => console.warn('Firestore 대표거래처 동기화 실패:', e));
}

export async function deleteAllGroupRules(): Promise<void> {
  if (IS_DEMO) return;
  await set(ref(rtdb, 'collectionGroupRules'), null);
  const snap = await getDocs(collection(firestore, 'collectionGroupRules')).catch(() => null);
  await Promise.all((snap?.docs || []).map(d => deleteDoc(d.ref))).catch(() => undefined);
}
