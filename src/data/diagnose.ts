import { get, onValue, ref, set } from 'firebase/database';
import { auth, rtdb, withTimeout } from './firebase';

const ms = (t0: number) => `${Math.round(performance.now() - t0)}ms`;
const why = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return [x?.code, x?.message].filter(Boolean).join(' / ') || String(e);
};

/**
 * 저장이 서버까지 가는지 단계별로 확인한다 (연결 → 로그인 → 쓰기 → 읽기 → 다른 경로(REST) 쓰기).
 * 어느 단계에서 막히는지 알면 원인(인터넷 · 로그인 · 보안 규칙)을 구분할 수 있다.
 */
export async function diagnoseSave(report: (line: string) => void): Promise<void> {
  const user = auth.currentUser;
  report(`1. 로그인: ${user ? `${user.email || '이메일 없음'} (uid ${user.uid.slice(0, 6)}…)` : '로그인 정보 없음 ✗'}`);
  report(`   인터넷: ${navigator.onLine ? '연결됨' : '끊김 ✗'}`);
  if (!user) return;

  const connected = await new Promise<boolean>(resolve => {
    const off = onValue(ref(rtdb, '.info/connected'), s => { if (s.val() === true) { off(); resolve(true); } });
    setTimeout(() => { off(); resolve(false); }, 8000);
  });
  report(`2. 서버(웹소켓) 연결: ${connected ? '연결됨 ✓' : '8초 안에 연결되지 않음 ✗ (와이파이/LTE 전환, 방화벽, 절전 모드 등 확인)'}`);

  const path = `diag/${user.uid}`;
  const stamp = new Date().toISOString();
  let t0 = performance.now();
  try {
    await withTimeout(set(ref(rtdb, path), { at: stamp }), 15000, '쓰기');
    report(`3. 쓰기: 서버가 받음 ✓ (${ms(t0)})`);
  } catch (e) {
    report(`3. 쓰기: 실패 ✗ (${ms(t0)}) ${why(e)}`);
  }

  t0 = performance.now();
  try {
    const v = (await withTimeout(get(ref(rtdb, path)), 15000, '읽기')).val() as { at?: string } | null;
    report(`4. 서버에서 다시 읽기: ${v?.at === stamp ? '방금 쓴 값이 있음 ✓' : '방금 쓴 값이 없음 ✗'} (${ms(t0)})`);
  } catch (e) {
    report(`4. 읽기: 실패 ✗ (${ms(t0)}) ${why(e)}`);
  }

  t0 = performance.now();
  try {
    const token = await user.getIdToken();
    const res = await withTimeout(fetch(`${rtdb.app.options.databaseURL}/${path}.json?auth=${token}`, { method: 'PUT', body: JSON.stringify({ at: stamp, via: 'rest' }) }), 15000, 'REST 쓰기');
    report(`5. 일반 웹요청(REST) 쓰기: ${res.ok ? '성공 ✓' : `실패 ✗ HTTP ${res.status} ${(await res.text()).slice(0, 120)}`} (${ms(t0)})`);
  } catch (e) {
    report(`5. 일반 웹요청(REST) 쓰기: 실패 ✗ (${ms(t0)}) ${why(e)}`);
  }
}
