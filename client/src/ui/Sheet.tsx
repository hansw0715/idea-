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
      // 시트가 열리자마자 키보드가 올라와 화면을 가리지 않게, 글자 입력 칸에는 자동으로 포커스를 주지 않는다.
      // (입력 칸이 아닌 요소는 그대로 initialFocus 로 포커스한다. 입력은 사용자가 칸을 눌렀을 때 시작한다.)
      const isTextEntry = (el: Element | null): boolean =>
        !!el && el.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"])');
      const wanted = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
      if (wanted && !isTextEntry(wanted)) wanted.focus();
      else if (isTextEntry(document.activeElement)) {
        // 브라우저 기본 동작이나 autofocus 로 입력 칸이 잡혔다면 닫기 버튼으로 옮긴다
        (document.activeElement as HTMLElement).blur();
        dialog.querySelector<HTMLElement>('.sheet__head button')?.focus();
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, render, initialFocus]);

  useEffect(() => {
    const dialog = ref.current;
    const viewport = window.visualViewport;
    if (!open || !render || !dialog || !viewport) return;

    // iOS 키보드는 100dvh 대신 visualViewport만 줄인다.
    // 시트별로 적용해 겹친 시트가 닫혀도 바깥 시트의 위치가 유지되게 한다.
    const fit = () => {
      if (viewport.scale > 1.01) return;
      const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      dialog.style.setProperty('--sheet-viewport-height', `${viewport.height}px`);
      dialog.style.setProperty('--sheet-viewport-bottom', `${bottom}px`);
      dialog.style.setProperty('--sheet-safe-bottom', bottom > 0 ? '0px' : 'var(--safe-bottom)');
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
      dialog.style.removeProperty('--sheet-viewport-height');
      dialog.style.removeProperty('--sheet-viewport-bottom');
      dialog.style.removeProperty('--sheet-safe-bottom');
    };
  }, [open, render]);

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
