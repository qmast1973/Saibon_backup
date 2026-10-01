import type { GroupRule, Transaction, User } from '../types';
import { belongsToMerchant } from './groups';
import { normalizeMarket } from './markets';

export const isAdmin = (u: User | null | undefined) => u?.role === 'admin';
export const isSubAdmin = (u: User | null | undefined) => u?.role === 'buyer' && !!u.isBuyerAdmin;
/** 관리자 또는 서브관리자(사입) */
export const hasAdminAccess = (u: User | null | undefined) => isAdmin(u) || isSubAdmin(u);
export const isBuyerLike = (u: User | null | undefined) => u?.role === 'buyer' || u?.role === 'admin';

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
    const assigned = new Set(user.assignedMerchants || []);
    const stores = new Set(users.filter(u => assigned.has(u.username) && u.storeName).map(u => u.storeName!.trim()));
    return all.filter(t => assigned.has(t.merchantId || '') || stores.has(String(t.store || '').trim()));
  }
  return [];
}

/** 사입삼촌에게 새 주문 알림을 보낼지 */
export function isRelevantForBuyer(t: Transaction, user: User): boolean {
  if (user.isBuyerAdmin) return true;
  if ((user.allowedMarkets || []).some(m => normalizeMarket(m) === normalizeMarket(t.market))) return true;
  return !!user.assignedRegion && user.assignedRegion !== '전체' && t.region === user.assignedRegion;
}
