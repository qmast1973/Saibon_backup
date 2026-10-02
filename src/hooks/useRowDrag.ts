import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 손잡이를 꾹 눌렀다가(0.3초) 끌어서 목록 순서를 바꾸는 훅 (마우스 · 터치 공통).
 * 끄는 동안 다른 줄은 움직이지 않고, 끄는 줄만 손가락을 따라가며 놓을 자리에 선이 표시된다. 놓으면 onDrop(key, 새 위치)을 부른다.
 * 화면 위/아래 가장자리로 끌면 스크롤된다.
 */
const HOLD_MS = 300;
const MOVE_TOLERANCE = 10; // 꾹 누르는 동안 이만큼 움직이면 스크롤 의도로 보고 취소
const EDGE = 70;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function useRowDrag(opts: { enabled: boolean; keys: string[]; onDrop: (key: string, toIndex: number) => void }) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [toIndex, setToIndex] = useState(0);
  const [translate, setTranslate] = useState(0);

  const rows = useRef(new Map<string, HTMLElement>());
  const live = useRef({ ...opts }); // 항상 최신 값을 쓰기 위한 참조
  live.current = { ...opts };
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (!opts.enabled) cleanup.current?.();
  }, [opts.enabled]);

  const rowRef = (key: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  };

  const start = (key: string, e: ReactPointerEvent) => {
    if (!live.current.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    cleanup.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    let y = startY;
    let active = false;
    let grab = 0; // 줄 안에서 잡은 위치
    let tr = 0;
    let to = 0;
    let raf = 0;

    const update = () => {
      const el = rows.current.get(key);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const baseTop = rect.top - tr;
      tr = y - grab - baseTop;
      setTranslate(tr);
      const others = live.current.keys.filter(k => k !== key);
      let n = 0;
      for (const k of others) {
        const r = rows.current.get(k)?.getBoundingClientRect();
        if (r && r.top + r.height / 2 < y) n++;
      }
      to = n;
      setToIndex(n);
    };

    const loop = () => {
      if (!active) return;
      const box = scrollParent(rows.current.get(key) ?? null);
      if (box) {
        const r = box.getBoundingClientRect();
        const top = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.innerHeight);
        if (y < top + EDGE) box.scrollTop -= Math.ceil(((top + EDGE - y) / EDGE) * 14);
        else if (y > bottom - EDGE) box.scrollTop += Math.ceil(((y - (bottom - EDGE)) / EDGE) * 14);
      }
      update();
      raf = requestAnimationFrame(loop);
    };

    const timer = window.setTimeout(() => {
      const el = rows.current.get(key);
      if (!el) return;
      active = true;
      grab = y - el.getBoundingClientRect().top;
      tr = 0;
      setDragKey(key);
      navigator.vibrate?.(15);
      loop();
    }, HOLD_MS);

    const move = (ev: PointerEvent) => {
      y = ev.clientY;
      if (!active && (Math.abs(ev.clientX - startX) > MOVE_TOLERANCE || Math.abs(ev.clientY - startY) > MOVE_TOLERANCE)) end(false);
      else if (active) ev.preventDefault();
    };
    const up = () => end(true);
    const stop = () => end(false);

    function end(commit: boolean) {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      cleanup.current = null;
      if (active && commit) {
        const from = live.current.keys.indexOf(key);
        if (to !== from) live.current.onDrop(key, to);
      }
      active = false;
      setDragKey(null);
      setTranslate(0);
    }

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    cleanup.current = () => end(false);
  };

  /** 줄(tr)에 붙일 스타일: 끄는 줄은 손가락을 따라가고 */
  const rowStyle = (key: string): CSSProperties | undefined =>
    dragKey === key ? { transform: `translateY(${translate}px)`, position: 'relative', zIndex: 20, transition: 'none' } : undefined;

  /** 놓을 자리 표시: 이 줄의 위(before) 또는 맨 끝 줄의 아래(after) */
  const dropMark = (key: string): 'before' | 'after' | null => {
    if (!dragKey || dragKey === key) return null;
    const others = opts.keys.filter(k => k !== dragKey);
    if (toIndex < others.length) return others[toIndex] === key ? 'before' : null;
    return others[others.length - 1] === key ? 'after' : null;
  };

  const handleProps = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent) => start(key, e),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    style: { touchAction: 'none', WebkitTouchCallout: 'none', userSelect: 'none' } as CSSProperties,
  });

  return { dragKey, rowRef, rowStyle, dropMark, handleProps };
}
