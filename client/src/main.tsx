import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 전역 css 를 먼저 불러야 페이지 css 의 같은 우선순위 규칙이 뒤에서 덮어쓴다.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';
import DownloadPage from './pages/DownloadPage';
import { isStandalone } from './shell/InstallBanner';

/**
 * 설치 화면: 기존 사이트의 /install (설치한 앱으로 연 경우가 아니면).
 * 앱을 기존 사이트 주소로 설치해야 폰 알림도 기존 사이트 이름으로 온다. 예전 설치 사이트(ss-booke-download)는 여기로 넘어온다.
 * (예전 설치 사이트 주소로 직접 열린 경우도 그대로 설치 화면을 보여 준다)
 */
const DOWNLOAD_SITE = location.pathname === '/install' || /^ss-booke[.-]download/.test(location.hostname);

// 폰 알림(웹 푸시)을 받는 서비스 워커. 화면·데이터를 캐시하지는 않는다 (public/sw.js)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 알림만 못 받을 뿐 앱은 그대로 쓴다 */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{DOWNLOAD_SITE && !isStandalone() ? <DownloadPage /> : <App />}</StrictMode>,
);
