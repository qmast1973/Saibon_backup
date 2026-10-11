import type { GroupRule, Transaction, User } from '../types';
import { belongsToMerchant } from './groups';
import { normalizeMarket } from './markets';

export const isAdmin = (u: User | null | undefined) => u?.role === 'admin';
export const isSubAdmin = (u: User | null | undefined) => u?.role === 'buyer' && !!u.isBuyerAdmin;
/** 관리자 또는 서브관리자(사입) */
export const hasAdminAccess = (u: User | null | undefined) => isAdmin(u) || isSubAdmin(u);
export const isBuyerLike = (u: User | null | undefined) => u?.role === 'buyer' || u?.role === 'admin';
/** 갯수 집계: 사입삼촌 · 관리자 + 물건을 받아 분류하는 지방삼촌 (지방삼촌은 담당 거래처 주문만 보인다) */
export const canSeeItemCounts = (u: User | null | undefined) => isBuyerLike(u) || u?.role === 'local';

/**
 * 역할별로 볼 수 있는 주문만 남긴다.
 *  - 관리자/서브관리자: 전체
 *  - 사입삼촌: 담당 건물 주문
 *  - 지방삼촌: 담당 상인(거래처) 주문
 *  - 상인: 자기 상호 + 대표거래처로 묶인 상호 주문
 */
export function filterVisible(all: Transaction[], user: User, users: User[], rules: GroupRule[]): Transaction[] {
  if (hasAdminAccess(user)) return all;

  if (user.role === 'merchant') return all.filter(t => belongsToMerchant(t, user, rules));

  if (user.role === 'buyer') {
    const markets = new Set((user.allowedMarkets || []).map(m => normalizeMarket(m)));
    return all.filter(t => markets.has(normalizeMarket(t.market)));
  }

  if (user.role === 'local') {
    // 담당 상인의 주문 + 그 상인과 대표거래처로 묶인 상호의 주문 (받은 물건을 거래처별로 분류해야 하므로)
    const assigned = new Set(user.assignedMerchants || []);
    const merchants = users.filter(u => u.role === 'merchant' && assigned.has(u.username));
    return all.filter(t => assigned.has(t.merchantId || '') || merchants.some(m => belongsToMerchant(t, m, rules)));
  }
  return [];
}

/** 사입삼촌에게 새 주문 알림을 보낼지 */
export function isRelevantForBuyer(t: Transaction, user: User): boolean {
  if (user.isBuyerAdmin) return true;
  if ((user.allowedMarkets || []).some(m => normalizeMarket(m) === normalizeMarket(t.market))) return true;
  return !!user.assignedRegion && user.assignedRegion !== '전체' && t.region === user.assignedRegion;
}
