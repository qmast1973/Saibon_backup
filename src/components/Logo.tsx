import { useState } from 'react';
import { cx } from './ui';

const LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/ildang-505711.firebasestorage.app/o/%EC%82%AC%EC%9E%85ON.png?alt=media&token=9aec0177-3023-4390-b1cb-b7d44a42aa97';

/** 로고 이미지를 못 불러오면 글자 로고로 대신한다 */
export function Logo({ className }: { className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="shrink-0 self-center text-2xl font-black tracking-tight text-white">사입<span className="text-indigo-300">ON</span></span>;
  return <img src={LOGO_URL} alt="사입ON" className={cx('w-auto shrink-0 object-contain', className)} onError={() => setFailed(true)} />;
}
