export type UserRole = 'merchant' | 'local' | 'buyer' | 'admin';

export interface User {
  username: string; // 소문자 고유키 (RTDB users/{username})
  name: string;
  role: UserRole;
  approved: boolean;
  uid?: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  isBuyerAdmin?: boolean; // 사입삼촌 중 서브관리자
  storeName?: string; // 상인
  businessNumber?: string; // 상인
  address?: string; // 상인
  isMonthlyPurchase?: boolean; // 상인: 월 고정 사입 (사입비 청구 제외)
  monthlyPurchaseAmount?: number;
  assignedRegion?: string; // 지방삼촌
  assignedMerchants?: string[]; // 지방삼촌: 담당 상인 username
  allowedMarkets?: string[]; // 사입삼촌: 담당 건물
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

/** 주문 · 입금 · 미수금 한 줄. 금액 단위는 천원. */
export interface Transaction {
  id: string;
  firebaseOrderId?: string;
  firebaseDate?: string;
  date: string; // YYYY-MM-DD (영업일 기준)
  store: string; // 소매 상호
  market: string; // 건물명 (또는 '입금' / '미수금')
  floor: string;
  room: string;
  manager: string; // 담당
  region: string;
  expense: number; // 대납금 (입금 건은 음수일 수 있음)
  income: number; // 입금액
  itemCount?: number;
  isReturn?: boolean;
  status?: string; // '' = 처리 대기
  remark?: string; // 주문 내용
  processingRemark?: string; // 사입삼촌 처리 비고
  isFeeExcluded?: boolean; // 수금화면: 사입비 강제 제외
  isFeeIncluded?: boolean; // 수금화면: 사입비 강제 포함
  recordType?: 'order' | 'receivable';
  localManager?: string;
  actualManager?: string;
  assignedManager?: string;
  merchantId?: string;
  merchantName?: string;
  merchantStoreName?: string;
  orderAt?: string | null;
  createdAt?: string;
}

/** 종속 거래처(storeName) → 대표 거래처(groupName) 묶음 규칙 */
export interface GroupRule {
  id: string;
  storeName: string;
  groupName: string;
  matchType: 'exact' | 'prefix';
  effectiveFrom: string;
  systemDefault?: boolean;
  createdAt?: string;
  note?: string;
  isMonthlyPurchase?: boolean;
  monthlyPurchaseAmount?: number;
}

export interface BoardComment {
  id: string;
  content: string;
  authorName: string;
  authorUsername: string;
  createdAt: string;
}

export interface BoardPost {
  id: string;
  title: string;
  content: string;
  authorName: string;
  authorUsername: string;
  createdAt: string;
  comments: BoardComment[];
}
