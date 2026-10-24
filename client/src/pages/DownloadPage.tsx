import { useEffect } from 'react';
import InstallButton from '../shell/InstallBanner';
import { Button } from '../ui';
import './auth.css';

/**
 * 브라우저로 들어오면 처음 보이는 화면. 로그인 화면과 같은 모양에
 * 파란 "웹앱으로 설치하기"와 그 아래 흰 "웹에서 사용하기" 두 버튼을 둔다.
 * 웹에서 사용하기를 누르면 로그인 화면(로그인돼 있으면 앱)으로 넘어간다 (main.tsx).
 * 설치한 앱(홈 화면 아이콘)으로 열면 이 화면 없이 바로 로그인 화면이 열린다.
 */
export default function DownloadPage({ onUseWeb }: { onUseWeb: () => void }) {
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
        <section className="auth-card" aria-label="시작하기">
          <InstallButton big />
          <Button type="button" variant="tertiary" size="xl" block className="download-web" onClick={onUseWeb}>
            웹에서 사용하기
          </Button>
        </section>
      </main>
    </div>
  );
}
