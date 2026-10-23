import { useEffect, useState } from 'react';
import { Button } from '../ui';

/**
 * 로그인 버튼 아래의 "앱으로 설치하기" 버튼 — 휴대폰에서 "앱처럼"(주소창 없이) 쓰도록 홈 화면 추가를 돕는다.
 * 브라우저는 사이트가 스스로 앱 모드로 바꾸는 것을 막으므로, 홈 화면에 한 번 추가하는 단계는 꼭 필요하다.
 *  - 안드로이드(크롬 등): 브라우저가 주는 설치 이벤트를 받아 두었다가 누르면 바로 설치 창을 띄운다.
 *    크롬은 잠시 써 본 뒤에야 이벤트를 주므로, 이벤트가 없으면 "⋮ 메뉴 → 홈 화면에 추가" 안내를 펼친다
 *  - 아이폰(사파리): 설치 창을 띄울 수 없어 "공유 → 홈 화면에 추가" 안내를 펼친다
 * 이미 홈 화면에서 연 경우(standalone)·PC 에서는 보이지 않는다.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

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

export default function InstallButton() {
  const [, rerender] = useState(0);
  const [hidden, setHidden] = useState(() => isStandalone() || !isMobile());
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (hidden) return null;
  const ios = isIos();

  async function install() {
    if (!deferred) {
      setShowHelp((v) => !v);
      return;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    if (choice.outcome === 'accepted') setHidden(true);
    else rerender((n) => n + 1);
  }

  return (
    <div className="install-cta">
      <Button type="button" variant="secondary" size="lg" block onClick={() => void install()} aria-expanded={showHelp}>
        앱으로 설치하기
      </Button>
      {showHelp && (
        <p className="install-cta__help">
          {ios ? (
            <>
              아래 <strong>공유 버튼</strong> → <strong>홈 화면에 추가</strong>를 누르면 주소창 없이 앱처럼 열려요.
            </>
          ) : (
            <>
              브라우저 메뉴(<strong>⋮</strong>) → <strong>홈 화면에 추가</strong>(또는 <strong>앱 설치</strong>)를 누르면
              주소창 없이 앱처럼 열려요.
            </>
          )}
        </p>
      )}
    </div>
  );
}
