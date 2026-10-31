import { Router } from 'express';

/** 휴대폰의 화면 모드('dark' | 'light'). client/index.html 의 첫 스크립트가 페이지를 열 때마다 적어 둔다 */
const SCHEME_COOKIE = 'sb-scheme';

const LIGHT = '#ffffff';
const DARK = '#16181b';

/**
 * 앱 설정 파일(웹 앱 매니페스트). 안드로이드는 설치·업데이트 때 이 파일의 background_color 로
 * 앱을 열 때 뜨는 시작(로딩) 화면을, theme_color 로 맨 아래 버튼 줄을 칠한다.
 * 그래서 휴대폰이 다크 모드면 어두운 색, 아니면 흰색을 적는다 (설치하는 순간·업데이트하는 순간의 휴대폰 설정).
 *
 * 화면 모드는 주소의 ?scheme=dark|light 로 받는다 (client/index.html 이 현재 모드로 주소를 만든다).
 * 삼성 인터넷·크롬은 설치할 때 이 파일을 쿠키 없이 다시 받기도 해서, 쿠키만 보면 흰색이 되던 문제가 있었다.
 * 주소에 모드가 없으면(예전 설치) 쿠키를 본다.
 */
export const manifestRouter = Router();

export function schemeOf(query: unknown, cookie: unknown): 'dark' | 'light' {
  if (query === 'dark' || query === 'light') return query;
  return cookie === 'dark' ? 'dark' : 'light';
}

manifestRouter.get('/', (req, res) => {
  const color = schemeOf(req.query.scheme, req.cookies?.[SCHEME_COOKIE]) === 'dark' ? DARK : LIGHT;
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
        background_color: color,
        theme_color: color,
        icons: [
          { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/brand/app-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/brand/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 설치 사이트가 "정말 깔렸는지" 확인할 때 쓴다 (getInstalledRelatedApps).
        // 설치한 앱의 설정 파일 주소와 같아야 하므로, 모드마다 달라지는 주소를 모두 적는다
        related_applications: ['/api/manifest?scheme=dark', '/api/manifest?scheme=light', '/api/manifest'].map((url) => ({ platform: 'webapp', url })),
      }),
    );
});
