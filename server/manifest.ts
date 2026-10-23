import { Router } from 'express';

/** 휴대폰의 화면 모드('dark' | 'light'). client/index.html 의 첫 스크립트가 페이지를 열 때마다 적어 둔다 */
const SCHEME_COOKIE = 'sb-scheme';

const LIGHT = '#ffffff';
const DARK = '#16181b';

/**
 * 앱 설정 파일(웹 앱 매니페스트). 크롬은 설치·업데이트 때 이 파일의 theme_color 로 설치한 앱의
 * 맨 아래 버튼 줄을 칠하고, 색이 없으면 시작 화면 색(background_color)으로 칠한다.
 * 그래서 휴대폰이 다크 모드면 어두운 색, 아니면 흰색을 적는다 (설치하는 순간·업데이트하는 순간의 휴대폰 설정).
 */
export const manifestRouter = Router();

manifestRouter.get('/', (req, res) => {
  const color = req.cookies?.[SCHEME_COOKIE] === 'dark' ? DARK : LIGHT;
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
