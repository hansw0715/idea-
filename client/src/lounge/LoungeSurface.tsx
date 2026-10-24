import type { ReactNode } from 'react';
import { AppHeader } from '../shell/Shell';
import { Sheet } from '../ui';

/** 주요 흐름은 같은 페이지 틀, 짧은 보조 작업은 기존 시트로 표시한다. */
export default function LoungeSurface({ presentation = 'sheet', open, onClose, title, footer, children }: {
  presentation?: 'sheet' | 'page'; open: boolean; onClose: () => void; title: string; footer?: ReactNode; children: ReactNode;
}) {
  if (presentation === 'sheet') return <Sheet open={open} onClose={onClose} title={title} footer={footer}>{children}</Sheet>;
  if (!open) return null;
  return <><AppHeader title={title} onBack={onClose} /><main id="main" className="app-main lounge-flow-page">
    <div className="card lounge-flow-panel">{children}{footer && <div className="lounge-flow-footer">{footer}</div>}</div>
  </main></>;
}
