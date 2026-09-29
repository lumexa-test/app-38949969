import { useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import type { FunctionComponent } from '@/common/types';

/**
 * CompareSlider — the approved design's draggable before/after comparison
 * tool (design-kit/user-approved-landing.html), extracted into a reusable
 * component so every screen that shows a real before/after pair (the
 * enhancement request detail page) gets the same approved look and
 * interaction instead of a static side-by-side pair.
 */
export function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel = 'Original',
  afterLabel = 'Enhanced',
}: {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel?: string;
  afterLabel?: string;
}): FunctionComponent {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const posFromEvent = (e: PointerEvent): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return pos;
    return ((e.clientX - rect.left) / rect.width) * 100;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPos((p) => clamp(p - 4)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPos((p) => clamp(p + 4)); }
    if (e.key === 'Home') { e.preventDefault(); setPos(0); }
    if (e.key === 'End') { e.preventDefault(); setPos(100); }
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => { setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); setPos(clamp(posFromEvent(e))); }}
      onPointerMove={(e) => { if (dragging) setPos(clamp(posFromEvent(e))); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className="relative isolate aspect-[4/3] w-full select-none overflow-hidden rounded-lg bg-[#d5c7bd] sm:aspect-[16/10]"
      aria-label="Drag the center divider to compare original photo to enhancement"
    >
      <img src={beforeSrc} alt={beforeAlt} loading="lazy" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 z-[2]" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={afterSrc} alt={afterAlt} loading="lazy" className="absolute inset-0 size-full object-cover" />
      </div>

      <span className="absolute left-3 top-3 z-[5] rounded-md border border-white/35 bg-black/35 px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[.45px] text-white backdrop-blur-sm">
        {afterLabel}
      </span>
      <span className="absolute right-3 top-3 z-[5] rounded-md border border-white/35 bg-black/35 px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[.45px] text-white backdrop-blur-sm">
        {beforeLabel}
      </span>

      <div className="absolute top-0 z-[4] h-full w-px -translate-x-1/2 bg-white/95" style={{ left: `${pos}%` }} aria-hidden />
      <div
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-label="Before and after comparison divider"
        onKeyDown={onKeyDown}
        className="absolute top-1/2 z-[4] grid size-[39px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-white bg-white text-[#31423a] shadow-[0_3px_13px_rgba(0,0,0,.16)]"
        style={{ left: `${pos}%` }}
      >
        <ChevronsLeftRight className="size-5" />
      </div>
    </div>
  );
}
