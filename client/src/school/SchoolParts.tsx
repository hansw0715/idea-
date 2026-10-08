/**
 * 학교 연동 화면들이 함께 쓰는 작은 조각: 오류 알림, 진행 표시, 시트 하단 버튼 줄, 시트 열림/닫힘 도우미.
 * 학번·비밀번호는 여기를 지나가지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Spinner } from '../ui';
import { classifySchoolError, isRetryable, needsRelink, schoolErrorMessage } from './errors';

/** 이 시간이 넘도록 학교가 답이 없으면 닫을 수 있게 푼다 (학교 응답은 보통 길어도 ~25초) */
const OVERDUE_MS = 45_000;

/**
 * 시트가 열릴 때마다 새 번호를 돌려준다. 이 번호를 key 로 써서 열 때마다 입력·결과·오류가 처음 상태에서 시작하게 한다.
 * (닫히는 400ms 동안에는 번호가 그대로라 내용이 갑자기 사라지지 않는다.)
 */
export function useOpenSession(open: boolean): number {
  const [prevOpen, setPrevOpen] = useState(open);
  const [session, setSession] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return session;
}

/**
 * 학교에 보낸 요청이 진행되는 동안 시트를 닫지 못하게 한다 (요청은 중간에 취소할 수 없고, 결과를 놓치지 않게).
 * 답이 너무 오래 없으면(overdue) 닫을 수 있게 풀어 사용자가 갇히지 않게 한다.
 */
export function useCloseGuard(busy: boolean, onClose: () => void): { close: () => void; overdue: boolean } {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!busy) {
      setOverdue(false);
      return;
    }
    const timer = window.setTimeout(() => setOverdue(true), OVERDUE_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);
  const close = useCallback(() => {
    if (!busy || overdue) onClose();
  }, [busy, overdue, onClose]);
  return { close, overdue };
}

interface WaitingProps {
  /** 지금 하는 일 ("학교에서 시간표를 불러오는 중…") */
  label: string;
  /** 시트를 닫을 수 없는 요청인가 */
  blocking?: boolean;
  overdue?: boolean;
}

/** 학교 응답을 기다리는 동안의 진행 표시. 응답이 느릴 수 있고 중간에 취소할 수 없다는 것을 알린다 */
export function SchoolWaiting({ label, blocking = true, overdue = false }: WaitingProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 진행 안내가 아래쪽에 생겨도 화면 밖에 가려지지 않게 한다 (취소할 수 없다는 안내를 놓치지 않도록)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div className="school-wait" role="status" aria-busy="true" ref={ref}>
      <Spinner />
      <div className="school-wait__text">
        <p className="school-wait__label">{label}</p>
        <p className="school-wait__sub">
          {overdue
            ? '학교 응답이 오래 걸리고 있어요. 이제 창을 닫을 수 있지만, 학교에서는 처리가 이어질 수 있어요. 닫으면 결과를 볼 수 없으니 필요하면 학교 사이트에서 확인해 주세요.'
            : blocking
              ? '학교 사이트 응답을 기다리고 있어요. 최대 30초쯤 걸릴 수 있고, 중간에 취소할 수 없어서 끝날 때까지 창을 닫을 수 없어요.'
              : '학교 사이트 응답을 기다리고 있어요. 최대 30초쯤 걸릴 수 있어요.'}
        </p>
      </div>
    </div>
  );
}

interface ErrorAlertProps {
  error: unknown;
  /** 무엇을 못 했는지 ("시간표를 가져오지 못했어요.") */
  title: string;
  /** "다시 연동하기" — 저장된 계정 정보로는 더 진행할 수 없는 오류(인증 실패·장기 잠금·키 없음·연동 없음)일 때만 보인다 */
  onRelink?: () => void;
  /** "다시 시도하기" — 학교 응답 없음·네트워크처럼 직접 다시 눌러 볼 만한 오류일 때만 보인다. 자동 재시도는 하지 않는다 */
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}

/** 학교 연동 오류를 한국어 문장으로 보여 주고, 오류 종류에 맞는 다음 행동만 둔다 */
export function SchoolErrorAlert({ error, title, onRelink, onRetry, retryLabel = '다시 시도하기', children }: ErrorAlertProps) {
  const kind = classifySchoolError(error);
  const showRelink = needsRelink(error) && onRelink;
  const showRetry = isRetryable(error) && onRetry;
  // 잠시 멈춤·응답 없음은 "잘못 입력함"이 아니라 "지금은 안 됨"이라 주의 색으로 구분한다 (글자·아이콘과 함께)
  const tone = kind === 'locked' || kind === 'locked-long' || kind === 'unavailable' || kind === 'network' ? 'warning' : 'danger';
  return (
    <Alert
      tone={tone}
      title={title}
      actions={
        showRelink || showRetry ? (
          <>
            {showRelink && (
              <Button variant="secondary" size="sm" onClick={onRelink}>
                다시 연동하기
              </Button>
            )}
            {showRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <p>{schoolErrorMessage(error)}</p>
      {children}
    </Alert>
  );
}

/** 시트 하단 버튼 줄. 자식은 [Primary, 나머지] 순서로 넣는다 — 한 줄이면 Primary 가 오른쪽, 쌓이면 위쪽에 온다 */
export function SchoolFoot({ children }: { children: ReactNode }) {
  return <div className="school-foot">{children}</div>;
}
