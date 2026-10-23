import { useEffect } from 'react';
import InstallButton from '../shell/InstallBanner';
import './auth.css';

/**
 * 설치 전용 사이트(ss-booke.download)의 화면. 어떤 주소로 들어와도 이 화면만 보인다.
 * 로그인 화면과 같은 모양에 "앱 설치하기" 큰 버튼 하나만 둔다.
 * 설치한 앱(홈 화면 아이콘)으로 열면 이 화면 대신 원래 앱이 열린다 (main.tsx).
 */
export default function DownloadPage() {
  // 로그인 화면처럼 아래로 내려가지 않게 막는다
  useEffect(() => {
    document.documentElement.classList.add('no-scroll');
    return () => document.documentElement.classList.remove('no-scroll');
  }, []);

  return (
    <div className="app-frame">
      <main id="main" className="app-main auth-main">
        <div className="auth-hero">
          <img
            className="auth-logo"
            src="/brand/logo.png"
            alt="상상Book-E · 예약도, 팀도, 상상처럼!"
            width="720"
            height="559"
          />
        </div>
        <section className="auth-card" aria-label="앱 설치">
          <InstallButton big />
        </section>
      </main>
    </div>
  );
}
