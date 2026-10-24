import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
// 전역 css 를 먼저 불러야 페이지 css 의 같은 우선순위 규칙이 뒤에서 덮어쓴다.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';
import DownloadPage from './pages/DownloadPage';
import { isStandalone } from './shell/InstallBanner';

/**
 * 예전 설치 전용 사이트(ss-booke-download.vercel.app). 이제 설치도 기존 사이트에서 하므로
 * 브라우저로 들어오면 기존 사이트로 보낸다. 거기서 이미 설치한 앱은 그대로 열린다.
 */
const DOWNLOAD_SITE = /^ss-booke[.-]download/.test(location.hostname);
if (DOWNLOAD_SITE && !isStandalone()) {
  location.replace('https://sangsang-booke.vercel.app' + location.pathname + location.search + location.hash);
}

/** "웹에서 사용하기"를 고른 브라우저는 다음부터 설치 화면 없이 바로 연다 */
const USE_WEB_KEY = 'sangsang-booke:use-web';
const choseWeb = () => {
  try {
    return localStorage.getItem(USE_WEB_KEY) === '1';
  } catch {
    return false;
  }
};

// 폰 알림(웹 푸시)을 받는 서비스 워커. 화면·데이터를 캐시하지는 않는다 (public/sw.js)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 알림만 못 받을 뿐 앱은 그대로 쓴다 */
    });
  });
}

/**
 * 새 버전 바로 반영: 앱을 다시 볼 때마다(다른 앱에 갔다 돌아오기 포함) 서버의 최신 화면 파일 이름을 확인해
 * 지금 화면과 다르면 새로 불러온다. 화면 파일 이름은 배포할 때마다 바뀐다 (/assets/index-해시.js)
 */
const currentBuild = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src ?? '';
let lastCheck = 0;
function reloadIfUpdated() {
  if (document.visibilityState !== 'visible' || !currentBuild || Date.now() - lastCheck < 15_000) return;
  lastCheck = Date.now();
  fetch('/', { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      const latest = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
      if (latest && !currentBuild.endsWith(latest)) location.reload();
    })
    .catch(() => {
      /* 인터넷이 없으면 지금 화면 그대로 */
    });
}
document.addEventListener('visibilitychange', reloadIfUpdated);
window.addEventListener('pageshow', reloadIfUpdated);

/** 브라우저로 들어오면 먼저 설치/웹에서 사용하기를 고르게 하고, 설치한 앱은 바로 로그인 화면부터 */
function Root() {
  const [useWeb, setUseWeb] = useState(() => isStandalone() || choseWeb());
  if (DOWNLOAD_SITE && !isStandalone()) return null;
  if (!useWeb)
    return (
      <DownloadPage
        onUseWeb={() => {
          try {
            localStorage.setItem(USE_WEB_KEY, '1');
          } catch {
            /* 기억 못 해도 이번에는 넘어간다 */
          }
          setUseWeb(true);
        }}
      />
    );
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
