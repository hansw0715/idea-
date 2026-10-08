// Supabase 비밀번호를 숨김 입력으로 받아 (1) 연결을 확인하고 (2) Netlify 사이트의 DATABASE_URL 로 등록한다.
// 비밀번호는 화면·로그·파일 어디에도 남기지 않는다.
// 사용: node scripts/connect-db.mjs
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const SITE_ID = '38f45180-e19c-4e1d-96b8-b0e9ef3e4247'; // sangsang-booke.netlify.app
const REF = 'dytgroeztqveiwciqrul';
const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const PORT = 6543; // Transaction pooler (서버리스용)

function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (c === '\u0003') process.exit(1); // Ctrl+C
        else if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

// DB_PASSWORD 환경 변수가 있으면 그것을 쓰고(자동 실행용), 없으면 숨김 입력으로 받는다.
const password = (
  process.env.DB_PASSWORD ??
  (await askHidden('Supabase 데이터베이스 비밀번호를 붙여넣고 Enter (화면에 표시되지 않습니다): '))
).trim();
if (!password) {
  console.error('비밀번호가 비어 있습니다.');
  process.exit(1);
}
const url = `postgresql://postgres.${REF}:${encodeURIComponent(password)}@${HOST}:${PORT}/postgres`;

// 1) 연결 확인
process.stdout.write('연결 확인 중… ');
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  max: 1,
});
try {
  await pool.query('select 1');
  console.log('성공');
} catch (e) {
  console.log('실패');
  const hint = /password authentication failed|SASL|tenant\/user/i.test(String(e.message))
    ? '비밀번호가 맞지 않거나 프로젝트가 아직 준비 중입니다. 비밀번호를 다시 확인해 주세요.'
    : String(e.message).split(password).join('<비밀번호>').slice(0, 200);
  console.error(`연결하지 못했습니다 (${e.code ?? 'error'}): ${hint}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
await pool.end().catch(() => {});

// 2) Netlify 환경 변수 등록 (셸을 거치지 않고 netlify-cli 를 직접 실행해 특수문자 문제를 피한다)
const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const cli = path.join(root, 'netlify-cli', 'bin', 'run.js');
process.stdout.write('Netlify 사이트에 DATABASE_URL 등록 중… ');
try {
  execFileSync(process.execPath, [cli, 'env:set', 'DATABASE_URL', url, '--site', SITE_ID, '--force'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('완료');
} catch (e) {
  console.log('실패');
  console.error(String(e.stderr ?? e.message).split(url).join('<url>').split(password).join('<비밀번호>').slice(0, 300));
  process.exit(1);
}
console.log('\n끝났습니다. Claude 에게 "입력했어" 라고 알려 주세요.');
