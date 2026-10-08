import { defineConfig } from 'vitest/config';

// 도메인 규칙(순수 함수) 테스트: server/lounge/domain, shared/lounge. DB·네트워크를 쓰지 않는다.
// client/src/**/*.test.ts: 학교 계정 금고(client/src/school/vault.test.ts)처럼 react·DOM 없이 도는 클라이언트 순수 로직.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
  },
});
