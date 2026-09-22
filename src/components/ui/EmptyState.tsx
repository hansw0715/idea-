import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      {icon && <span className="text-2xl">{icon}</span>}
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="text-xs text-muted">{children}</div>}
    </div>
  );
}
