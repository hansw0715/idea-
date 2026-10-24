import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Icon from './Icon';

interface ToastOptions {
  tone?: 'neutral' | 'success';
  /** "되돌리기"처럼 스낵바에 붙는 행동 */
  action?: { label: string; onClick: () => void };
  /** 자동으로 닫히기까지 ms (기본 4000) */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type ShowFn = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ShowFn>(() => undefined);

/** 저장·복사·담기처럼 가벼운 확인 메시지. 중요한 결과(예약 완료 등)는 화면 안 Alert 로 남긴다. */
export function useToast(): ShowFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ShowFn>(
    (message, options) => {
      const id = ++seq.current;
      // 한 번에 하나만: 새 메시지가 오면 이전 것은 치운다.
      setItems([{ id, message, ...options }]);
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
      timers.current.set(id, window.setTimeout(() => dismiss(id), options?.duration ?? 4000));
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {items.map((t) => (
          <div className="toast" key={t.id} role="status">
            <Icon name={t.tone === 'success' ? 'check' : 'info'} className="toast__mark" />
            <span className="toast__text">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="알림 닫기"><Icon name="close" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
