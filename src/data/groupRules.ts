import { onValue, ref, set } from 'firebase/database';
import type { GroupRule } from '../types';
import { IS_DEMO, rtdb, write } from './firebase';

/** 대표거래처 규칙은 RTDB collectionGroupRules (배열)에 저장한다. */

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

export async function saveGroupRules(rules: GroupRule[]): Promise<void> {
  if (IS_DEMO) return;
  const clean = cleanRules(rules);
  await write(set(ref(rtdb, 'collectionGroupRules'), clean), '대표거래처 저장');
}

export async function deleteAllGroupRules(): Promise<void> {
  if (IS_DEMO) return;
  await set(ref(rtdb, 'collectionGroupRules'), null);
}
