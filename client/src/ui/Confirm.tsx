import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Alert } from './Feedback';

export interface ConfirmOptions {
  title: string;
  /** 되돌릴 수 없는 결과가 있으면 그 결과를 구체적으로 적는다. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' 이면 확인 버튼이 위험 색(채움)으로 그려진다. 기본은 Primary. */
  tone?: 'primary' | 'danger';
  /**
   * 확인 눌렀을 때 실행할 비동기 작업. 주면 응답이 올 때까지 다이얼로그를 닫지 않고
   * 버튼을 처리 중으로 바꾸며, 실패하면 다이얼로그 안에 오류를 보여 준 채 다시 시도할 수 있다.
   */
  run?: () => Promise<void>;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** const ok = await confirm({ title: '…', tone: 'danger', run: () => api.del(...) }) → 완료하면 true, 취소하면 false */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface Pending {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/** KRDS "확인" 패턴: 되돌릴 수 없는 행위 직전에 의도를 다시 묻는 중앙 다이얼로그 (취소에 초기 포커스) */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setBusy(false);
        setCurrent({ options, resolve });
      }),
    [],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (current && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    }
  }, [current]);

  function finish(ok: boolean) {
    const pending = current;
    if (!pending) return;
    // 내용은 남겨 두어 페이드 아웃 동안 빈 상자가 보이지 않게 한다. 다음 confirm 에서 교체된다.
    ref.current?.close();
    pending.resolve(ok);
  }

  async function onConfirm() {
    const run = current?.options.run;
    if (!run) {
      finish(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run();
      finish(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  const o = current?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={ref}
        className="dialog"
        aria-labelledby={titleId}
        aria-describedby={o?.message ? messageId : undefined}
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) finish(false);
        }}
      >
        {o && (
          <>
            <h2 className="dialog__title" id={titleId}>
              {o.title}
            </h2>
            {o.message && (
              <div className="dialog__message" id={messageId}>
                {o.message}
              </div>
            )}
            {error && (
              <div className="dialog__error">
                <Alert tone="danger">{error}</Alert>
              </div>
            )}
            <div className="dialog__actions">
              <Button variant="tertiary" onClick={() => finish(false)} disabled={busy} ref={cancelRef}>
                {o.cancelLabel ?? '취소'}
              </Button>
              <Button
                variant={o.tone === 'danger' ? 'danger-solid' : 'primary'}
                onClick={onConfirm}
                loading={busy}
              >
                {busy ? '처리 중…' : (o.confirmLabel ?? '확인')}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
