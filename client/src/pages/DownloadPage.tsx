import { useEffect, useState } from 'react';
import { hideSplash } from '../shell/splash';
import InstallButton, { isIos } from '../shell/InstallBanner';
import './auth.css';

/** iOS 공유 버튼 모양 (네모 위로 화살표) */
function ShareIcon() {
  return (
    <svg className="install-guide__share" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10H5v11h14V10h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 아이폰 크롬 아래 막대의 더보기 버튼 모양 (점 세 개). 공유 버튼이 안 보이면 이걸 누른다 */
function ChromeMoreIcon() {
  return (
    <svg className="install-guide__share" viewBox="0 0 24 24" aria-label="더보기" role="img">
      <circle cx="5" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * 사이트는 앱 설치용으로만 쓴다. 브라우저로 들어오면 어떤 주소든 이 화면만 보인다.
 * 큰 로고, "앱 설치하기" 버튼, 그 아래 Android · iOS · Mac 설치 방법.
 * 아이폰은 크롬으로 열어 설치한다 (index.html 이 넘긴다). 버튼으로 설치 창을 띄울 수 없어,
 * 누르면 크롬 주소창 오른쪽의 공유 버튼 쪽을 화살표로 가리킨다.
 * 설치한 앱(홈 화면 아이콘)으로 열면 이 화면 대신 로그인 화면부터 원래 앱이 열린다 (main.tsx).
 */
export default function DownloadPage() {
  // 설치 화면은 기다릴 것이 없어 바로 로딩 화면을 걷는다
  useEffect(hideSplash, []);
  const [pointShare, setPointShare] = useState(false);
  const ios = isIos();
  const android = /android/i.test(navigator.userAgent);
  // 맥(사파리)은 공유 → Dock에 추가. 아이패드도 Macintosh 로 알리므로 터치가 없을 때만 맥으로 본다
  const mac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;

  // 로그인 화면처럼 아래로 내려가지 않게 막는다
  useEffect(() => {
    document.documentElement.classList.add('no-scroll');
    return () => document.documentElement.classList.remove('no-scroll');
  }, []);

  return (
    <div className="app-frame">
      <main id="main" className="app-main auth-main download-main">
        <img
          className="download-logo"
          src="/brand/logo.png"
          alt="상상Book-E · 예약도, 팀도, 상상처럼!"
          width="720"
          height="559"
        />
        <section className="download-cta" aria-label="앱 설치">
          <InstallButton big onIosHelp={() => setPointShare(true)} />
        </section>
        <section className="install-guide" aria-label="설치 방법">
          <div className={`install-guide__item${android ? ' install-guide__item--mine' : ''}`}>
            <h2 className="install-guide__os">Android</h2>
            <ol>
              <li>
                "안전하지 않은 앱 차단됨"이 뜨면
                <br />
                <strong>세부 정보 더 보기</strong> → <strong>무시하고 설치하기</strong>
              </li>
            </ol>
          </div>
          <div className={`install-guide__item${ios ? ' install-guide__item--mine' : ''}`}>
            <h2 className="install-guide__os">iOS</h2>
            <ol>
              <li>
                크롬 주소창 오른쪽 <ShareIcon /> <strong>공유</strong> 버튼 (안 보이면 <ChromeMoreIcon /> → <strong>공유</strong>)
              </li>
              <li>
                <strong>홈 화면에 추가</strong> → 오른쪽 위 <strong>추가</strong>
              </li>
            </ol>
          </div>
          <div className={`install-guide__item${mac ? ' install-guide__item--mine' : ''}`}>
            <h2 className="install-guide__os">Mac</h2>
            <ol>
              <li>
                사파리 오른쪽 위 <ShareIcon /> <strong>공유</strong> 버튼
              </li>
              <li>
                <strong>Dock에 추가</strong> → <strong>추가</strong>
              </li>
            </ol>
          </div>
        </section>
      </main>
      {pointShare && (
        <div className="share-pointer" role="status">
          <span className="share-pointer__arrow" aria-hidden="true">
            ↑
          </span>
          <span className="share-pointer__bubble">
            여기 <ShareIcon /> 공유 → <strong>홈 화면에 추가</strong>
          </span>
        </div>
      )}
    </div>
  );
}
