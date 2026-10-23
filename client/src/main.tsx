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
 * 설치 전용 사이트(ss-booke.download · ss-booke-download.vercel.app)에서는
 * 설치한 앱으로 연 경우가 아니면 어느 주소든 설치 화면만 보여 준다
 */
const DOWNLOAD_SITE = /^ss-booke[.-]download/.test(location.hostname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{DOWNLOAD_SITE && !isStandalone() ? <DownloadPage /> : <App />}</StrictMode>,
);
