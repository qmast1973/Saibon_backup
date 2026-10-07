import { useState } from 'react';
import { getFontScale, setFontScale } from '../data/localCache';
import { cx } from './ui';

const LEVELS: { scale: number; label: string }[] = [
  { scale: 1, label: '보통' },
  { scale: 1.15, label: '크게' },
  { scale: 1.3, label: '더 크게' },
  { scale: 1.5, label: '가장 크게' },
];

/** 화면 전체 글자 크기 배율을 적용한다 (루트 글자 크기를 곱하므로 모든 글씨 · 간격이 같이 커진다) */
export function applyFontScale(scale: number) {
  document.documentElement.style.setProperty('--fs', String(scale));
}

/** 앱이 뜨기 전에 저장된 배율을 적용한다 */
export function initFontScale() {
  applyFontScale(getFontScale());
}

/** 글자 크기 고르기. 눌러 보면 바로 커지고, 이 기기에 저장된다. */
export function FontSizePicker({ compact }: { compact?: boolean }) {
  const [scale, setScale] = useState(getFontScale);
  const choose = (v: number) => {
    setScale(v);
    setFontScale(v);
    applyFontScale(v);
  };
  return (
    <div className={cx('rounded-xl border border-gray-700 bg-gray-800/50 p-3', compact && 'border-gray-800 bg-gray-950')}>
      <p className="mb-2 text-sm font-bold text-gray-100">글자 크기</p>
      <div className="grid grid-cols-2 gap-1.5">
        {LEVELS.map(l => (
          <button
            key={l.scale}
            type="button"
            onClick={() => choose(l.scale)}
            aria-pressed={scale === l.scale}
            className={cx(
              'min-h-[48px] whitespace-nowrap rounded-lg border px-1 py-1 font-bold leading-tight',
              scale === l.scale ? 'border-indigo-300 bg-indigo-600 text-white' : 'border-gray-600 bg-gray-900 text-gray-200',
            )}
          >
            <span className="block text-sm">{l.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">누르면 바로 바뀌고, 이 기기에 저장됩니다.</p>
    </div>
  );
}
