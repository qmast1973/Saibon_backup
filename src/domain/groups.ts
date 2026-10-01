import type { GroupRule, Transaction, User } from '../types';
import { compact, fuzzyIncludes, sortKo } from './text';

/** 소매 상호 → 대표 거래처명. 묶음 규칙이 없으면 상호 그대로. */
export function getBillingStore(store: string, rules: GroupRule[]): string {
  const rawName = String(store ?? '').trim();
  if (!rawName) return rawName;
  const name = compact(rawName);

  const asGroup = rules.find(r => r.groupName && compact(r.groupName) === name);
  if (asGroup) return asGroup.groupName.trim();

  const matched = rules
    .filter(r => {
      if (!r.storeName || !r.groupName) return false;
      const ruleStore = compact(r.storeName);
      if (r.matchType === 'prefix') return name.startsWith(ruleStore) || ruleStore.startsWith(name);
      // 정확 일치 + "상호A지점" ↔ "상호A" 같은 포함 관계
      return name === ruleStore || name.includes(ruleStore) || ruleStore.includes(name);
    })
    .sort((a, b) => {
      const aExact = compact(a.storeName) === name;
      const bExact = compact(b.storeName) === name;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || ''));
    });
  return matched.length > 0 ? matched[0].groupName.trim() : rawName;
}

/** 대표 거래처에 묶인 종속 상호들 (대표 자신 제외) */
export function getSubStores(groupName: string, rules: GroupRule[]): string[] {
  const group = compact(groupName);
  const subs = new Set<string>();
  for (const r of rules) {
    if (!r.groupName || !r.storeName) continue;
    if (compact(r.groupName) === group && compact(r.storeName) !== group) subs.add(r.storeName.trim());
  }
  return [...subs];
}

export function getGroupNames(rules: GroupRule[]): string[] {
  return [...new Set(rules.map(r => r.groupName?.trim()).filter(Boolean) as string[])].sort(sortKo);
}

/**
 * 대표/종속 묶음까지 고려한 검색.
 * 대표 상호로 검색하면 종속 상호 주문도, 종속 상호로 검색하면 같은 묶음 주문도 함께 나온다.
 */
export function matchesTransaction(t: Transaction, query: string, rules: GroupRule[]): boolean {
  if (!query.trim()) return true;
  const store = String(t.store || '').trim();
  if (fuzzyIncludes(store, query)) return true;

  const billing = getBillingStore(store, rules);
  if (fuzzyIncludes(billing, query)) return true;
  if (getSubStores(billing, rules).some(sub => fuzzyIncludes(sub, query))) return true;

  const fields = [
    t.room, t.floor, t.manager, t.localManager, t.actualManager, t.assignedManager,
    t.market, t.region, t.status, t.remark, t.processingRemark,
  ];
  return fields.some(f => fuzzyIncludes(f, query));
}

export interface StoreSuggestion {
  type: 'group' | 'subordinate' | 'general';
  name: string;
  representative: string;
  subStores: string[];
}

/** 검색창 자동완성: 대표 → 종속 → 일반 상호 순서, 최대 10개 */
export function getStoreSuggestions(query: string, rules: GroupRule[], knownStores: string[]): StoreSuggestion[] {
  if (!query.trim()) return [];
  const results: StoreSuggestion[] = [];
  const seen = new Set<string>();
  const add = (key: string, s: StoreSuggestion) => {
    if (seen.has(key)) return;
    seen.add(key);
    results.push(s);
  };

  for (const group of getGroupNames(rules)) {
    const subStores = getSubStores(group, rules);
    if (fuzzyIncludes(group, query) || subStores.some(s => fuzzyIncludes(s, query))) {
      add(`n:${compact(group)}`, { type: 'group', name: group, representative: group, subStores });
    }
  }
  for (const r of rules) {
    if (!r.storeName || !r.groupName || compact(r.storeName) === compact(r.groupName)) continue;
    if (fuzzyIncludes(r.storeName, query)) {
      add(`n:${compact(r.storeName)}`, {
        type: 'subordinate', name: r.storeName.trim(), representative: r.groupName.trim(), subStores: [r.storeName.trim()],
      });
    }
  }
  for (const store of knownStores) {
    if (!store.trim() || !fuzzyIncludes(store, query)) continue;
    const rep = getBillingStore(store, rules);
    const isSub = compact(rep) !== compact(store);
    add(`n:${compact(store)}`, {
      type: isSub ? 'subordinate' : 'general', name: store.trim(), representative: rep, subStores: isSub ? getSubStores(rep, rules) : [],
    });
  }
  return results.slice(0, 10);
}

/**
 * 상인 로그인 시 함께 볼 상호 묶음 (자기 상호 + 대표/종속으로 연결된 상호).
 */
export function getMerchantBundle(merchant: User, rules: GroupRule[], allStores: string[]): string[] {
  const mine = (merchant.storeName || merchant.name || '').trim();
  if (!mine) return [];
  const me = compact(mine);
  const bundle = new Set([mine]);
  const related = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

  for (const r of rules) {
    const group = compact(r.groupName);
    const store = compact(r.storeName);
    if (!group || !store) continue;
    if (related(group, me)) {
      bundle.add(r.storeName.trim());
      if (r.matchType === 'prefix') {
        for (const s of allStores) {
          const cs = compact(s);
          if (cs && (cs.startsWith(store) || store.startsWith(cs))) bundle.add(s.trim());
        }
      }
    } else if (related(store, me)) {
      bundle.add(r.groupName.trim());
    }
  }
  return [...bundle].sort(sortKo);
}

/** 상인 화면: 이 주문이 로그인한 상인의 묶음에 속하는지 */
export function belongsToMerchant(t: Transaction, merchant: User, rules: GroupRule[]): boolean {
  if (t.merchantId && t.merchantId === merchant.username) return true;
  const me = compact(merchant.storeName || merchant.name);
  const store = compact(t.store);
  if (!me || !store) return false;
  const related = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);
  if (related(store, me)) return true;

  return rules.some(r => {
    const group = compact(r.groupName);
    const ruleStore = compact(r.storeName);
    if (related(group, me)) {
      return r.matchType === 'prefix'
        ? store.startsWith(ruleStore) || ruleStore.startsWith(store)
        : related(store, ruleStore);
    }
    if (related(ruleStore, me)) return related(store, group);
    return false;
  });
}

/** 대표/종속 묶음을 위로 올려 정렬 (클릭한 상호 기준) */
export function sortByStoreFocus<T extends { store: string; date?: string }>(items: T[], focusStore: string | null, rules: GroupRule[]): T[] {
  if (!focusStore?.trim()) return items;
  const target = compact(getBillingStore(focusStore, rules));
  const inFocus = (s: string) => compact(getBillingStore(s, rules)) === target || compact(s) === target;
  return [...items].sort((a, b) => {
    const af = inFocus(a.store), bf = inFocus(b.store);
    if (af !== bf) return af ? -1 : 1;
    const byStore = sortKo(a.store || '', b.store || '');
    if (byStore !== 0) return byStore;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
}

/** 대표 거래처가 월사입(사입비 청구 제외)인지: 묶음 규칙 또는 상인 회원 정보 */
export function getMonthlyPurchase(billingStore: string, rules: GroupRule[], users: User[]): { isMonthly: boolean; amount: number } {
  const key = compact(billingStore);
  const rule = rules.find(r => compact(r.groupName) === key && r.isMonthlyPurchase);
  if (rule) return { isMonthly: true, amount: rule.monthlyPurchaseAmount || 0 };
  const merchant = users.find(u => u.role === 'merchant' && compact(u.storeName) === key && u.isMonthlyPurchase);
  if (merchant) return { isMonthly: true, amount: merchant.monthlyPurchaseAmount || 0 };
  return { isMonthly: false, amount: 0 };
}
