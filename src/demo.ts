// 아티팩트 미리보기용 데모 모드 (VITE_DEMO=1 빌드에서만 사용). 예시 데이터를 캐시에 넣고 관리자로 로그인한 상태로 시작한다.
import type { GroupRule, Transaction, User } from './types';
import { getBusinessDate } from './domain/dates';

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

export async function seedDemo() {
  const d = getBusinessDate();
  const users: User[] = [
    { username: 'demo', name: '예시관리자', role: 'admin', approved: true },
    { username: 'buyer1', name: '예시삼촌', role: 'buyer', approved: true, allowedMarkets: ['디오트', 'APM', '청평화', '테크노'] },
    { username: 'local1', name: '지방삼촌A', role: 'local', approved: true, assignedRegion: '합성동', assignedMerchants: ['m1'] },
    { username: 'm1', name: '대표자A', role: 'merchant', approved: true, storeName: '대표상호A' },
    { username: 'm2', name: '대표자B', role: 'merchant', approved: false, storeName: '예시상호B' },
  ];
  const rules: GroupRule[] = [{ id: 'g1', storeName: '상호A-1', groupName: '대표상호A', matchType: 'exact', effectiveFrom: '' }];
  const mk = (i: number, o: Partial<Transaction>): Transaction => ({
    id: `firebase_${d}_demo${i}`, firebaseOrderId: `demo${i}`, firebaseDate: d, date: d, store: '예시상호B', market: '디오트',
    floor: '3', room: '12호', manager: '', region: '합성동', expense: 0, income: 0, status: '', ...o,
  });
  const orders: Transaction[] = [
    mk(1, { store: '대표상호A', market: '디오트', floor: '3', room: 'f10호', expense: 35, status: '주문찾기', itemCount: 2, remark: '셔츠 2장' }),
    mk(2, { store: '상호A-1', market: 'APM', floor: '2', room: '18호 (도매상호)', expense: 12 }),
    mk(3, { store: '예시상호B', market: '청평화', floor: '지하1', room: '라23', remark: '바지 2장' }),
    mk(4, { store: '대표상호A', market: '입금', floor: '', room: '', income: 20, status: '완료', remark: '수금' }),
    mk(5, { store: '예시상호C', market: '테크노', floor: '1', room: '5호', status: '미송(찾기)', itemCount: 1, isReturn: true }),
    mk(6, { store: '예시상호C', market: '디자이너', floor: '2', room: '15호', expense: 8 }),
  ];
  try {
    localStorage.setItem('saipon.autoLogin', 'true');
    // 링크 끝에 #buyer / #local / #merchant 를 붙이면 그 역할로 시작 (기본: 관리자)
    const as = { buyer: users[1], local: users[2], merchant: users[3] }[location.hash.slice(1)] || users[0];
    localStorage.setItem('saipon.session.v2', JSON.stringify({ user: as, loginAt: Date.now() }));
    localStorage.setItem('saipon.users.v2', JSON.stringify(users));
    localStorage.setItem('saipon.rules.v2', JSON.stringify(rules));
  } catch { /* noop */ }
  try {
    await new Promise<void>(resolve => {
      const r = indexedDB.open('saipon-cache', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('orders');
      r.onsuccess = () => {
        const tx = r.result.transaction('orders', 'readwrite');
        tx.objectStore('orders').put(orders, 'all');
        tx.oncomplete = tx.onerror = () => { r.result.close(); resolve(); };
      };
      r.onerror = () => resolve();
    });
  } catch { /* noop */ }
}
