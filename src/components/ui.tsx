import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Eye, EyeOff, Layers, Search, Store, X } from 'lucide-react';
import { hangulToQwerty } from '../domain/keyboard';
import type { GroupRule } from '../types';
import { getStoreSuggestions } from '../domain/groups';
import { useApp } from '../state/AppContext';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// 버튼
// ---------------------------------------------------------------------------

type Tone = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'ghost' | 'violet';
const TONES: Record<Tone, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  warning: 'bg-amber-600 hover:bg-amber-500 text-white',
  violet: 'bg-violet-700 hover:bg-violet-600 text-white',
  ghost: 'bg-transparent hover:bg-gray-800 text-gray-300',
};

export function Button({
  tone = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'px-2.5 py-1 text-[11px]', md: 'px-3.5 py-2 text-xs', lg: 'px-5 py-3 text-sm' };
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
        TONES[tone],
        sizes[size],
        className,
      )}
    />
  );
}

/**
 * 파일 고르기 버튼.
 * 투명한 파일 입력칸을 버튼 전체에 겹쳐서 손가락이 입력칸을 직접 누르게 한다.
 * (숨긴 입력칸을 코드나 label 로 대신 여는 방식은 일부 휴대폰 · 앱 내부 브라우저 · 미리보기에서 막힌다)
 */
export function FileButton({
  accept, onFile, disabled, tone = 'secondary', children,
}: { accept: string; onFile: (file: File) => void; disabled?: boolean; tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-xl px-3.5 py-2 text-xs font-bold transition focus-within:ring-2 focus-within:ring-indigo-400',
        TONES[tone],
        disabled && 'opacity-40',
      )}
    >
      <span className="pointer-events-none inline-flex items-center gap-1.5">{children}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        title=""
        aria-label={typeof children === 'string' ? children : '파일 선택'}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </span>
  );
}

/** 모달/화면 우측 상단 전용 닫기 버튼 (다른 버튼과 섞이지 않게 항상 단독 배치) */
export function CloseButton({ onClick, label = '닫기' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2.5 py-1.5 text-xs font-bold text-gray-200 transition"
    >
      <X className="w-4 h-4" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 입력
// ---------------------------------------------------------------------------

export const inputClass =
  'w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-950 disabled:text-gray-400 disabled:cursor-not-allowed';

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-bold text-gray-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-500">{hint}</span>}
    </label>
  );
}

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => <input {...rest} className={cx(inputClass, className)} />;
export const Select = ({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...rest} className={cx(inputClass, className)} />;
export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={2} {...rest} className={cx(inputClass, 'resize-none', className)} />
);

/**
 * 비밀번호 입력 (눈 아이콘으로 입력한 글자 확인).
 * 한글 자판 상태로 쳐도 같은 자리의 영문으로 바꿔 넣는다 (예: ㅁㅇㅡㅑㅜ → admin). 글자를 몰래 지우지 않는다.
 */
export function PasswordInput({
  value, onChange, placeholder, autoComplete = 'current-password', required,
}: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        required={required}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={e => onChange(hangulToQwerty(e.target.value))}
        placeholder={placeholder}
        className={cx(inputClass, 'pr-11')}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(!show)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white"
        aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}
        title={show ? '비밀번호 숨기기' : '비밀번호 보기'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** 천원 단위 금액 입력 ("15" → 15,000원) */
export function MoneyInput({ value, onChange, placeholder = '0', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="flex items-center rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500">
      <input
        inputMode="numeric"
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9-]/g, ''))}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-lg font-bold text-gray-100 outline-none"
      />
      <span className="ml-0.5 shrink-0 font-mono text-sm font-bold text-gray-400">,000원</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-700 bg-gray-800/50 p-3 text-left hover:bg-gray-800"
    >
      <span>
        <span className="block text-sm font-bold text-gray-100">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] text-gray-400">{description}</span>}
      </span>
      <span className={cx('relative h-5 w-10 shrink-0 rounded-full transition', checked ? 'bg-indigo-500' : 'bg-gray-600')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-5' : 'left-0.5')} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 모달 / 전체 화면
// ---------------------------------------------------------------------------

function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

// 여러 창이 겹쳐 있을 때 Esc 는 맨 위 창만 닫는다
const escapeStack: symbol[] = [];

function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const id = Symbol('modal');
    escapeStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeStack[escapeStack.length - 1] === id) ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      escapeStack.splice(escapeStack.indexOf(id), 1);
    };
  }, []);
}

export function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  size = 'md',
  z = 'z-[200]',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  z?: string;
}) {
  useBodyScrollLock();
  useEscape(onClose);
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className={cx('fixed inset-0 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4', z)} role="dialog" aria-modal="true">
      <div className={cx('flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl', widths[size])}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-800 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-black text-gray-100">
              {icon}
              <span className="truncate">{title}</span>
            </h3>
            {subtitle && <p className="mt-0.5 text-[11px] text-gray-400">{subtitle}</p>}
          </div>
          <CloseButton onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-800 px-4 py-3 sm:px-5">{footer}</footer>}
      </div>
    </div>
  );
}

/** 수금관리 · 주문처리 처럼 화면 전체를 덮는 작업 화면 */
export function Screen({
  title,
  badge,
  subtitle,
  actions,
  onClose,
  children,
  z = 'z-[150]',
  width = 'max-w-5xl',
}: {
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  z?: string;
  width?: string;
}) {
  useBodyScrollLock();
  return (
    <div className={cx('fixed inset-0 overflow-y-auto overscroll-contain bg-gray-950 text-gray-100', z)}>
      <div className={cx('mx-auto px-3 pb-24 pt-3 sm:px-4 sm:pt-4', width)}>
        <header className="mb-4 flex items-start justify-between gap-3 border-b border-gray-800 pb-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-black tracking-tight text-white sm:text-xl">
              {title}
              {badge}
            </h1>
            {subtitle && <p className="mt-0.5 text-[11px] text-gray-400">{subtitle}</p>}
          </div>
          <CloseButton onClick={onClose} />
        </header>
        {actions && <div className="mb-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '확인',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: Tone;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} size="sm" z="z-[400]"
      footer={
        <>
          <Button onClick={onCancel}>취소</Button>
          <Button tone={tone} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="whitespace-pre-line text-sm text-gray-300">{message}</div>
    </Modal>
  );
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 p-10 text-center text-xs text-gray-500">
      {icon && <div className="mb-2 flex justify-center opacity-60">{icon}</div>}
      {children}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold', className)}>{children}</span>;
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  const tones = { info: 'bg-gray-800 border-gray-600', success: 'bg-emerald-700 border-emerald-500', error: 'bg-rose-700 border-rose-500' };
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[1000] flex flex-col items-center gap-2 px-3">
      {toasts.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className={cx('pointer-events-auto max-w-md rounded-2xl border px-4 py-2.5 text-sm font-bold text-white shadow-2xl whitespace-pre-line', tones[t.tone])}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 상호 검색 (대표/종속 거래처 추천 포함)
// ---------------------------------------------------------------------------

export function StoreSearch({
  value,
  onChange,
  knownStores,
  rules,
  placeholder = '상호/대표거래처 검색 (초성 가능)',
  required,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  knownStores: string[];
  rules: GroupRule[];
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const suggestions = open ? getStoreSuggestions(value, rules, knownStores) : [];

  useEffect(() => {
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <input
        value={value}
        required={required}
        autoFocus={autoFocus}
        aria-controls={listId}
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value && setOpen(true)}
        placeholder={placeholder}
        className={cx(inputClass, 'pl-9 pr-8')}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label="지우기">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {suggestions.length > 0 && (
        <ul id={listId} className="absolute inset-x-0 top-full z-[300] mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 shadow-2xl divide-y divide-gray-800">
          {suggestions.map(s => (
            <li key={`${s.type}:${s.name}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.name);
                  setOpen(false);
                }}
                className="w-full px-3 py-2.5 text-left hover:bg-indigo-950/50"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.type === 'group' && <Badge className="bg-violet-900 text-violet-200"><Layers className="h-3 w-3" />대표</Badge>}
                  {s.type === 'subordinate' && <Badge className="bg-cyan-950 text-cyan-200"><Store className="h-3 w-3" />종속</Badge>}
                  <span className="text-sm font-bold text-gray-100">{s.name}</span>
                  {s.type === 'subordinate' && <span className="text-[11px] text-gray-400">→ 대표: <b className="text-violet-300">{s.representative}</b></span>}
                </span>
                {s.type === 'group' && s.subStores.length > 0 && (
                  <span className="mt-1 block truncate text-[11px] text-gray-400">종속 {s.subStores.length}곳: {s.subStores.join(', ')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
