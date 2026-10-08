import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Icon from './Icon';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 하단 고정 버튼 영역 (Primary 는 하나만) */
  footer?: ReactNode;
  /** 화면 전체를 덮는 시트 (다단계 흐름용) */
  full?: boolean;
  /** 열릴 때 포커스를 줄 요소의 selector. 기본은 첫 입력/버튼 */
  initialFocus?: string;
}

const CLOSE_MS = 400;

/**
 * 모바일 바텀 시트. 네이티브 <dialog>.showModal() 을 써서
 * 배경 inert · Tab 순환 · Esc 닫기 · 포커스 복원을 브라우저가 처리한다.
 * 닫힌 뒤 400ms 동안은 내용을 유지해 슬라이드 아웃이 자연스럽게 보인다.
 */
export function Sheet({ open, onClose, title, children, footer, full = false, initialFocus }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [render, setRender] = useState(open);

  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    const t = window.setTimeout(() => setRender(false), CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && render && !dialog.open) {
      dialog.showModal();
      if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, render, initialFocus]);

  if (!render && !open) return null;

  return (
    <dialog
      ref={ref}
      className={`sheet${full ? ' sheet--full' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // 겹친 시트에서 Esc·뒤로 가기가 바깥 시트까지 닫지 않게 한 겹만 처리한다.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        // 어두운 배경(= dialog 자신) 을 누르면 닫는다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet__head">
        <h2 className="sheet__title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="닫기">
          <Icon name="close" className="btn__icon" />
        </button>
      </div>
      <div className="sheet__body">{children}</div>
      {footer && <div className="sheet__foot">{footer}</div>}
    </dialog>
  );
}
