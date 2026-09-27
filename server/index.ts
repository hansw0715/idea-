// 로컬 실행 시 .env 파일을 읽는다. (서버리스 플랫폼은 실제 환경 변수를 직접 주입한다)
import 'dotenv/config';
import { createApp } from './app.js';

const PORT = Number(process.env.API_PORT ?? 3001);

createApp().listen(PORT, () => {
  console.log(`API server: http://localhost:${PORT}`);
});
