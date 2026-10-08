import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { MARKET_SEPARATOR_RE } from '../domain/markets';
import { Input, cx } from './ui';

const sepLabel = (s: string) => s.replace(/^=+\s*|\s*=+$/g, '').trim();

/**
 * 건물명 입력칸: 직접 쓰거나 목록에서 고른다.
 * 목록 중간의 '===== 남대문 =====' 같은 구분선은 눌러도 선택되지 않는 구분 줄로만 보인다.
 * (브라우저 기본 목록은 구분선을 보여 줄 수 없어 직접 만든 목록을 쓴다)
 */
export function MarketInput({
  value, options, disabled, placeholder, onChange, onBlur,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 200 && above > below; // 아래 공간이 좁으면 위로 연다 (화면 밖으로 나가지 않게)
    const width = Math.min(Math.max(r.width, 200), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setBox(up ? { left, width, bottom: window.innerHeight - r.top + 4, maxH: Math.min(320, above) } : { left, width, top: r.bottom + 4, maxH: Math.min(320, below) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => { if (!(e.target instanceof Node) || !document.getElementById('market-panel')?.contains(e.target)) setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const exact = options.some(o => o === value);
  const filtering = q !== '' && !exact;
  const shown = filtering ? options.filter(o => !MARKET_SEPARATOR_RE.test(o) && o.toLowerCase().includes(q)) : options;

  return (
    <div ref={ref} className="min-w-0">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onBlur={e => { setOpen(false); onBlur(e); }}
      />
      {open && !disabled && box && shown.length > 0 && (
        <div
          id="market-panel"
          role="listbox"
          className="fixed z-[500] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-2xl"
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxH }}
        >
          {shown.map((m, i) =>
            MARKET_SEPARATOR_RE.test(m) ? (
              <div key={`${m}${i}`} aria-hidden className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-bold text-gray-400">
                <span className="h-px flex-1 bg-gray-600" />{sepLabel(m) || '구분'}<span className="h-px flex-1 bg-gray-600" />
              </div>
            ) : (
              <button
                key={`${m}${i}`}
                type="button"
                role="option"
                aria-selected={m === value}
                // 누르는 순간 입력칸이 포커스를 잃어 목록이 닫히는 것을 막는다
                onMouseDown={e => { e.preventDefault(); onChange(m); setOpen(false); }}
                className={cx('block min-h-10 w-full rounded-lg px-3 text-left text-sm hover:bg-gray-800', m === value ? 'bg-indigo-950 font-bold text-indigo-200' : 'text-gray-100')}
              >
                {m}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
