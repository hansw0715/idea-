'use client';

/** 가로로 스크롤되는 칩형 탭. 노선 선택, 시간표 종류 선택 등에 쓴다. */
import { cx } from './cx';

export type TabItem<T extends string> = { value: T; label: string; hint?: string };

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1', className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cx(
              'shrink-0 rounded-pill border px-3 py-1.5 text-sm transition',
              active
                ? 'border-brand bg-brand text-white'
                : 'border-border bg-surface text-foreground hover:bg-surface-muted',
            )}
          >
            {it.label}
            {it.hint && <span className={cx('ml-1 text-[11px]', active ? 'text-white/80' : 'text-muted')}>{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
