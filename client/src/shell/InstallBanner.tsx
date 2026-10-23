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
/**
 * 크롬이 "설치함"을 알린 뒤(appinstalled) 실제로 홈 화면에 다 깔렸는지.
 * appinstalled 는 설치를 시작할 때 오므로(아직 "설치 중"), 브라우저에 이 앱이 깔려 있는지 직접 물어 확인한다.
 */
let installed = false;
let installStarted = false;
const listeners = new Set<() => void>();

type RelatedApp = { platform: string; url?: string };
const relatedApps = (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<RelatedApp[]> })
  .getInstalledRelatedApps;

/** 앱이 정말 깔렸는지 1초마다 확인하다가 깔리면 "완료". 확인할 수 없는 브라우저는 appinstalled 를 그대로 믿는다 */
function watchInstalled() {
  if (installStarted) return;
  installStarted = true;
  if (!relatedApps) {
    installed = true;
    listeners.forEach((fn) => fn());
    return;
  }
  const check = () => {
    relatedApps
      .call(navigator)
      .then((apps) => {
        if (apps.some((a) => a.platform === 'webapp')) {
          installed = true;
          listeners.forEach((fn) => fn());
        } else window.setTimeout(check, 1000);
      })
      .catch(() => window.setTimeout(check, 1000));
  };
  check();
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    watchInstalled();
  });
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * big: 설치 전용 사이트의 큰 버튼. PC 에서도 보이고, 설명 문구 없이 버튼만 둔다.
 * 브라우저가 설치 창을 띄울 수 있으면 화면 어디를 눌러도 바로 설치 창이 뜬다.
 */
export default function InstallButton({ big = false }: { big?: boolean }) {
  const [, rerender] = useState(0);
  const [hidden, setHidden] = useState(() => isStandalone() || (!big && !isMobile()));
  const [showHelp, setShowHelp] = useState(false);
  /** 설치 사이트: 버튼을 누른 뒤에는 버튼 안에 로딩을 띄우고, 차단 화면 넘기는 방법을 아래에 작게 적는다 */
  const [pressed, setPressed] = useState(false);
  // 설치 창에서 "설치"를 누른 뒤에는 실제로 홈 화면에 다 깔릴 때까지 로딩을 돌리고, 그때 "완료"를 띄운다
  const done = installed;

  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  useEffect(() => {
    if (!big) return;
    // 설치 창은 사용자가 화면을 누른 순간에만 띄울 수 있어, 어디를 누르든 그 한 번으로 띄운다
    const onTap = (e: MouseEvent) => {
      if (!deferred || (e.target as HTMLElement).closest('.install-cta')) return;
      void install();
    };
    document.addEventListener('click', onTap);
    return () => document.removeEventListener('click', onTap);
  });

  if (hidden) return null;
  const ios = isIos();

  async function install() {
    if (!deferred) {
      // 크롬이 설치 창을 아직 줄 수 없으면(방금 지운 앱·닫은 설치 창 등) 메뉴로 설치하는 방법을 펼친다
      setShowHelp(true);
      return;
    }
    if (big) setPressed(true);
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    if (choice.outcome === 'accepted') {
      if (!big) setHidden(true);
      else watchInstalled();
    } else {
      setPressed(false);
      rerender((n) => n + 1);
    }
  }

  return (
    <div className={`install-cta${big ? ' install-cta--big' : ''}`}>
      <Button
        type="button"
        variant={big ? 'primary' : 'secondary'}
        size={big ? 'xl' : 'lg'}
        block
        onClick={() => void install()}
        loading={pressed && !done}
        aria-label={pressed && !done ? '설치하는 중' : undefined}
        aria-expanded={big ? undefined : showHelp}
      >
        {done ? '완료' : !pressed && '앱 설치하기'}
      </Button>
      {big && (
        <p className="install-cta__note">안전하지 않은 앱 차단됨 시 &gt; 세부 정보 더 보기 &gt; 무시하고 설치하기</p>
      )}
      {showHelp && isMobile() && (
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
