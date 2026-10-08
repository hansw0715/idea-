import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// cody(5173/3001)와 같은 PC에서 동시에 실행해도 부딪히지 않도록 다른 포트를 쓴다.
const API_PORT = process.env.API_PORT ?? '3101';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    // 서버와 함께 쓰는 공용 계약(../shared)을 개발 서버가 내보낼 수 있게 한다.
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
  },
});
