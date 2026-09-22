import type { ReactNode } from 'react';
import { cx } from './cx';

type Tone = 'brand' | 'neutral' | 'accent' | 'danger' | 'success';

const TONE: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand',
  neutral: 'bg-surface-muted text-muted',
  accent: 'bg-accent/15 text-accent',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold', TONE[tone], className)}
    >
      {children}
    </span>
  );
}
