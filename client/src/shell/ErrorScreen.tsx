import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from '../ui';

/** KRDS 오류(서버·네트워크): 전체 화면 대체 메시지 + 새로고침 + 안내 */
export function ErrorScreen({ onRetry }: { onRetry?: () => void }) {
  return (
    <main className="fullscreen-msg" role="alert">
      <h1 className="page-title">일시적으로 서비스를 이용할 수 없습니다</h1>
      <p className="text-sub">
        화면을 불러오는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. 계속 같은 문제가 생기면
        상상Book-E 운영팀에 알려 주세요.
      </p>
      <Button size="lg" block onClick={onRetry ?? (() => window.location.reload())}>
        새로고침하기
      </Button>
    </main>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <ErrorScreen />;
    return this.props.children;
  }
}
