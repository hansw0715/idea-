import { useEffect, useState } from 'react';
import { Button, Icon } from '../ui';

/**
 * 휴대폰에서 "앱처럼"(주소창 없이) 쓰도록 홈 화면 추가를 권하는 띠.
 * 브라우저는 사이트가 스스로 앱 모드로 바꾸는 것을 막으므로, 홈 화면에 한 번 추가하는 단계는 꼭 필요하다.
 *  - 안드로이드(크롬 등): 브라우저가 주는 설치 이벤트를 받아 두었다가 "설치" 한 번으로 추가.
 *    크롬은 잠시 써 본 뒤에야 이벤트를 주고, 카카오톡 같은 앱 안 브라우저는 아예 주지 않으므로
 *    이벤트가 없으면 "⋮ 메뉴 → 홈 화면에 추가" 안내를 대신 보여 준다
 *  - 아이폰(사파리): 설치 버튼이 없어 "공유 → 홈 화면에 추가" 안내만
 * 이미 홈 화면에서 연 경우(standalone)·PC·닫은 뒤에는 보이지 않는다.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = 'sangsang-booke-install-dismissed';

/** 첫 화면이 그려지기 전에 온 설치 이벤트도 놓치지 않게 모듈이 읽힐 때부터 받아 둔다 */
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function InstallBanner() {
  const [, rerender] = useState(0);
  const [hidden, setHidden] = useState(() => isStandalone() || !isMobile() || wasDismissed());

  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (hidden) return null;
  const ios = isIos();
  const canPrompt = !ios && deferred !== null;

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* 저장이 막혀도 이번에는 닫힌다 */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    if (choice.outcome === 'accepted') setHidden(true);
    else rerender((n) => n + 1);
  }

  return (
    <div className="install-banner" role="region" aria-label="앱으로 쓰기">
      <img className="install-banner__icon" src="/brand/mark-64.png" alt="" width="36" height="36" />
      <p className="install-banner__text">
        {ios ? (
          <>
            <strong>앱처럼 쓰기</strong> 아래 공유 버튼 → <strong>홈 화면에 추가</strong>를 누르면 주소창 없이 열려요.
          </>
        ) : canPrompt ? (
          <>
            <strong>앱처럼 쓰기</strong> 홈 화면에 추가하면 주소창 없이 바로 열려요.
          </>
        ) : (
          <>
            <strong>앱처럼 쓰기</strong> 브라우저 메뉴(⋮) → <strong>홈 화면에 추가</strong>를 누르면 주소창 없이 열려요.
          </>
        )}
      </p>
      {canPrompt && (
        <Button size="sm" onClick={() => void install()}>
          설치
        </Button>
      )}
      <button type="button" className="install-banner__close" onClick={dismiss} aria-label="닫기">
        <Icon name="close" />
      </button>
    </div>
  );
}
