import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';

// 웹 클라이언트용 공개 설정값 (비밀키 아님). 실제 접근 통제는 Firebase 보안 규칙이 담당한다.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCKUn8yVyL9V5NP9rpHWbtcDddiwW1MWSQ',
  authDomain: 'ildang-505711.firebaseapp.com',
  databaseURL: 'https://purchaseon-351f4-default-rtdb.firebaseio.com',
  projectId: 'ildang-505711',
  storageBucket: 'ildang-505711.firebasestorage.app',
  messagingSenderId: '176312937811',
  appId: '1:176312937811:web:9c4602f12842e52d2c85a6',
};

const FIRESTORE_DATABASE_ID = 'ai-studio-on-ba5d27f4-0ded-436f-9039-97f519ed3c99';

export const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const firestore = getFirestore(app, FIRESTORE_DATABASE_ID);

/** 미리보기(데모) 빌드: Firebase에 전혀 접속하지 않고 화면에서만 동작한다 */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/**
 * 쓰기 요청. 연결이 끊겨 있으면 Firebase가 요청을 보관했다가 다시 연결될 때 보내므로,
 * 시간 안에 응답이 없어도 실패로 보지 않고 계속 진행한다. (권한 거부 같은 진짜 오류는 그대로 알린다)
 */
export async function write(promise: Promise<unknown>, label: string, ms = 10000): Promise<void> {
  try {
    await withTimeout(promise, ms, label);
  } catch (e) {
    if (!String((e as Error)?.message).includes('시간 초과')) throw e;
    console.warn(`${label}: 응답 지연 - 연결되면 자동으로 저장됩니다.`);
  }
}

/** 네트워크가 끊겨도 화면이 멈추지 않도록 일정 시간 후 포기한다. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = '요청'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms)),
  ]);
}
