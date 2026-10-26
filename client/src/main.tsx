import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 전역 css 를 먼저 불러야 페이지 css 의 같은 우선순위 규칙이 뒤에서 덮어쓴다.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';
import DownloadPage from './pages/DownloadPage';
import { isStandalone } from './shell/InstallBanner';
import './styles/refresh.css';

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

// 사이트는 앱 설치용: 브라우저에서는 설치 화면만, 설치한 앱에서는 로그인부터 원래 앱
createRoot(document.getElementById('root')!).render(
  <StrictMode>{isStandalone() ? <App /> : <DownloadPage />}</StrictMode>,
);
