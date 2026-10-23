import { Router } from 'express';

/** 앱에 지금 보이는 화면 모드(설정에서 고른 값, 없으면 휴대폰 화면 모드)를 담는 쿠키. client/src/ui/Display.tsx 가 쓴다 */
export const THEME_COOKIE = 'sb-theme';

const LIGHT = '#ffffff';
const DARK = '#16181b';

/**
 * 앱 설정 파일(웹 앱 매니페스트). 크롬은 설치·업데이트 때 이 파일의 theme_color 로
 * 설치한 앱의 맨 아래 버튼 줄을 칠한다.
 *  - 앱이 마지막으로 보인 모드(쿠키)의 색을 적는다 (크롬이 앱을 업데이트할 때 반영된다)
 *  - 쿠키가 없으면(처음 설치) theme_color 를 적지 않는다
 * 주소는 /api/manifest 하나로 고정해, 모드에 따라 주소가 바뀌며 생기던 업데이트 꼬임을 없앤다.
 */
export const manifestRouter = Router();

manifestRouter.get('/', (req, res) => {
  const choice = req.cookies?.[THEME_COOKIE];
  const theme = choice === 'dark' ? DARK : choice === 'light' ? LIGHT : null;
  res
    .type('application/manifest+json')
    .set('Cache-Control', 'no-store')
    .send(
      JSON.stringify({
        id: '/',
        name: '상상Book-E',
        short_name: '상상Book-E',
        description: '같이 밥 먹고, 같이 만나고, 같이 이용하는 한성 캠퍼스 연결 플랫폼',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: choice === 'dark' ? DARK : LIGHT,
        ...(theme && { theme_color: theme }),
        icons: [
          { src: '/brand/mark-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/brand/mark-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/brand/mark-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 설치 사이트가 "정말 깔렸는지" 확인할 때 쓴다 (getInstalledRelatedApps)
        related_applications: [{ platform: 'webapp', url: '/api/manifest' }],
      }),
    );
});
