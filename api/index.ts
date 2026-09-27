// Vercel 서버리스 함수 진입점. Express 앱을 그대로 핸들러로 넘긴다.
import { createApp } from '../server/app.js';

export default createApp();
