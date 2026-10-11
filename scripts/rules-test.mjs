// DB 규칙(database.rules.json) 시험: Firebase 에뮬레이터로 승인 전 · 승인된 상인 · 관리자 · 최초 관리자 상황을 확인한다.
// 실행 (별도 폴더에서 firebase-tools, @firebase/rules-unit-testing, firebase 를 설치한 뒤):
//   firebase emulators:exec --only database --project demo-saibon "node scripts/rules-test.mjs"
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { ref, get, set, update } from 'firebase/database';
const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = async (name, p) => { try { await p; pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, String(e.message).slice(0, 120)); } };

async function env() {
  return initializeTestEnvironment({ projectId: 'demo-saibon', database: { rules, host: '127.0.0.1', port: 9000 } });
}
const te = await env();
await te.clearDatabase();
await te.withSecurityRulesDisabled(async ctx => {
  const db = ctx.database();
  await set(ref(db, '/'), {
    adminUids: { ADM: true },
    approvedUids: { ADM: true, MER: true },
    users: {
      owner: { username: 'owner', uid: 'ADM', role: 'admin', approved: true },
      mer: { username: 'mer', uid: 'MER', role: 'merchant', approved: true },
    },
    orders: { '2026-10-08': { o1: { 상호: 'A', 대납금: 1 } } },
    settings: { markets: ['APM'] },
    collectionGroupRules: [{ id: 'g1' }],
  });
});
const as = uid => (uid ? te.authenticatedContext(uid).database() : te.unauthenticatedContext().database());

console.log('비로그인');
await t('주문 읽기 거부', assertFails(get(ref(as(null), 'orders'))));

console.log('가입만 한 사람(승인 전)');
const S = as('STR');
await t('주문 읽기 거부', assertFails(get(ref(S, 'orders'))));
await t('주문 쓰기 거부', assertFails(set(ref(S, 'orders/2026-10-08/x'), { 상호: 'hack' })));
await t('회원 목록 읽기 거부', assertFails(get(ref(S, 'users'))));
await t('설정 읽기 거부', assertFails(get(ref(S, 'settings'))));
await t('대표거래처 쓰기 거부', assertFails(set(ref(S, 'collectionGroupRules'), [])));
await t('내 승인 여부 읽기 허용', assertSucceeds(get(ref(S, 'approvedUids/STR'))));
await t('승인 명단 전체 읽기 거부', assertFails(get(ref(S, 'approvedUids'))));
await t('남의 승인 여부 읽기 거부', assertFails(get(ref(S, 'approvedUids/MER'))));
await t('스스로 승인 쓰기 거부', assertFails(set(ref(S, 'approvedUids/STR'), true)));
await t('스스로 관리자 쓰기 거부', assertFails(set(ref(S, 'adminUids/STR'), true)));
await t('대기 기록 만들기 허용', assertSucceeds(set(ref(S, 'users/str'), { username: 'str', uid: 'STR', role: 'merchant', approved: false })));
await t('role admin 으로 만들기 거부', assertFails(set(ref(S, 'users/str2'), { username: 'str2', uid: 'STR', role: 'admin', approved: false })));
await t('approved true 로 만들기 거부', assertFails(set(ref(S, 'users/str3'), { username: 'str3', uid: 'STR', role: 'merchant', approved: true })));
await t('서브관리자로 만들기 거부', assertFails(set(ref(S, 'users/str4'), { username: 'str4', uid: 'STR', role: 'buyer', approved: false, isBuyerAdmin: true })));
await t('남의 uid 로 만들기 거부', assertFails(set(ref(S, 'users/str5'), { username: 'str5', uid: 'MER', role: 'merchant', approved: false })));
await t('남의 기록 덮어쓰기 거부', assertFails(set(ref(S, 'users/mer'), { username: 'mer', uid: 'STR', role: 'merchant', approved: false })));
await t('대기 기록 스스로 승인 거부', assertFails(update(ref(S, 'users/str'), { approved: true })));
await t('진단 경로 내 것 허용', assertSucceeds(set(ref(S, 'diag/STR'), { at: 1 })));
await t('진단 경로 남의 것 거부', assertFails(set(ref(S, 'diag/ADM'), { at: 1 })));

console.log('승인된 상인');
const M = as('MER');
await t('주문 읽기 허용', assertSucceeds(get(ref(M, 'orders'))));
await t('주문 쓰기 허용', assertSucceeds(set(ref(M, 'orders/2026-10-08/o2'), { 상호: 'B' })));
await t('회원 목록 읽기 허용', assertSucceeds(get(ref(M, 'users'))));
await t('설정 읽기 허용', assertSucceeds(get(ref(M, 'settings'))));
await t('내 순서 저장 허용', assertSucceeds(set(ref(M, 'users/mer/storeOrder'), ['A'])));
await t('내 전화번호 수정 허용', assertSucceeds(update(ref(M, 'users/mer'), { phone: '010' })));
await t('내 권한을 admin 으로 변경 거부', assertFails(set(ref(M, 'users/mer/role'), 'admin')));
await t('내 승인 취소/변경 거부', assertFails(set(ref(M, 'users/mer/approved'), false)));
await t('서브관리자 권한 부여 거부', assertFails(set(ref(M, 'users/mer/isBuyerAdmin'), true)));
await t('남의 기록 수정 거부', assertFails(update(ref(M, 'users/owner'), { phone: 'x' })));
await t('승인 명단 쓰기 거부', assertFails(set(ref(M, 'approvedUids/STR'), true)));
await t('관리자 명단 쓰기 거부', assertFails(set(ref(M, 'adminUids/MER'), true)));
await t('내 기록 삭제 거부', assertFails(set(ref(M, 'users/mer'), null)));

console.log('관리자');
const A = as('ADM');
await t('승인 명단 전체 읽기 허용', assertSucceeds(get(ref(A, 'approvedUids'))));
await t('새 계정 승인 허용', assertSucceeds(set(ref(A, 'approvedUids/STR'), true)));
await t('회원 승인 값 변경 허용', assertSucceeds(update(ref(A, 'users/str'), { approved: true })));
await t('회원 삭제 허용', assertSucceeds(set(ref(A, 'users/str'), null)));
await t('주문 읽기/쓰기 허용', assertSucceeds(set(ref(A, 'orders/2026-10-08/o3'), { 상호: 'C' })));
await t('루트 전체 읽기 거부', assertFails(get(ref(A, '/'))));

console.log('방금 승인된 사람은 바로 접근');
await t('승인 직후 주문 읽기 허용', assertSucceeds(get(ref(as('STR'), 'orders'))));

console.log('관리자가 아직 없는 새 DB(최초 관리자)');
await te.clearDatabase();
await t('처음 로그인한 계정이 최초 관리자 등록 허용', assertSucceeds(update(ref(as('FIRST'), '/'), { 'adminUids/FIRST': true, 'approvedUids/FIRST': true })));
await t('그 뒤 다른 계정의 관리자 등록 거부', assertFails(set(ref(as('LATE'), 'adminUids/LATE'), true)));
await t('그 뒤 다른 계정의 승인 등록 거부', assertFails(set(ref(as('LATE'), 'approvedUids/LATE'), true)));

await te.cleanup();
console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
