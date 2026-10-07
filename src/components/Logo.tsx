import { useState } from 'react';
import { cx } from './ui';

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;

/** 로고 이미지를 못 불러오면 글자 로고로 대신한다 */
export function Logo({ className }: { className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="shrink-0 self-center text-2xl font-black tracking-tight text-white">사입<span className="text-indigo-300">ON</span></span>;
  return <img src={LOGO_URL} alt="사입ON" className={cx('w-auto shrink-0 object-contain', className)} onError={() => setFailed(true)} />;
}
