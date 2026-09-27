// Netlify Functions 진입점. serverless-http로 Express 앱을 Lambda 핸들러로 감싼다.
import serverless from 'serverless-http';
import { createApp } from '../../server/app.js';

const app = createApp();

export const handler = serverless(app, {
  request(request: { url?: string }) {
    // Netlify 버전에 따라 함수 경로가 그대로 넘어오기도 하고 리다이렉트된 경로가 오기도 한다.
    // 두 경우 모두 Express가 아는 `/api/...` 형태로 정규화한다.
    if (typeof request.url === 'string') {
      request.url = request.url.replace(/^\/\.netlify\/functions\/api/, '') || '/';
    }
  },
});
