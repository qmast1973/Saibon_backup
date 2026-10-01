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

/** 네트워크가 끊겨도 화면이 멈추지 않도록 일정 시간 후 포기한다. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = '요청'): Promise<T> {
  if (import.meta.env.VITE_DEMO === '1') ms = 800;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms)),
  ]);
}
