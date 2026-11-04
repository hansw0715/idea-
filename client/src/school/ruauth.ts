/**
 * e-class 원격수업 본인 인증(코스모스 ruauth)을 앱에서 대신 진행한다 — 카카오 알림톡 방식만.
 *
 * e-class 인증 화면(/local/ruauth/)의 스크립트가 브라우저에서 하는 일을 그대로 한다:
 *  1. ruauth 서버에 socket.io(v2, Engine.IO 3)로 붙는다 → 붙는 순간 학생 휴대폰으로 알림톡이 간다.
 *  2. 학생이 알림톡 링크를 누르거나, 받은 인증코드를 앱에 넣으면(POST /api/v1/code/{코드}) 소켓에 'authorized' 가 온다.
 *  3. 그다음 서버(/api/school/eclass/verify)가 e-class 에 인증 완료를 알린다(checkUserAuth.php).
 *
 * socket.io 클라이언트 라이브러리(v2) 대신 필요한 만큼(연결·ping·이벤트 받기)만 직접 구현했다.
 * token 에는 본인의 전화번호·이메일이 들어 있으므로 주소창·로그·저장소에 남기지 않는다(소켓 주소에만 실린다).
 */
import type { EclassVerification } from '../../../shared/school/eclass';

const RUAUTH_ORIGIN = 'https://ruauth.coursemos.co.kr';
const SOCKET_URL = 'wss://ruauth.coursemos.co.kr/conn/';

export type RuauthEvent =
  /** 소켓이 붙었다 = 알림톡을 보냈다 */
  | { type: 'sent' }
  | { type: 'authorized' }
  /** noPhone: 학교에 휴대폰 번호가 없다 (ruauth 오류 코드 200). message: ruauth 가 준 문장(한국어)이 있으면 */
  | { type: 'error'; noPhone: boolean; message?: string }
  | { type: 'closed' };

export interface RuauthSession {
  close(): void;
}

/** 알림톡 인증을 시작한다. 돌려받은 close() 로 끊는다 (화면을 떠날 때 반드시) */
export function startKakaoAuth(v: Pick<EclassVerification, 'token' | 'organizationCode'>, onEvent: (e: RuauthEvent) => void): RuauthSession {
  const query = new URLSearchParams({
    EIO: '3',
    transport: 'websocket',
    token: v.token,
    organizationCode: v.organizationCode,
    type: 'kakao',
  });
  const ws = new WebSocket(`${SOCKET_URL}?${query}`);
  let ping: number | undefined;
  let done = false;
  const finish = (e: RuauthEvent) => {
    if (done) return;
    done = true;
    window.clearInterval(ping);
    onEvent(e);
    try {
      ws.close();
    } catch {
      /* 이미 닫혔다 */
    }
  };

  ws.onmessage = (msg) => {
    const data = typeof msg.data === 'string' ? msg.data : '';
    if (data.startsWith('0{')) {
      // 열림: pingInterval 마다 ping("2")을 보내야 연결이 유지된다
      let interval = 25_000;
      try {
        interval = Number(JSON.parse(data.slice(1)).pingInterval) || interval;
      } catch {
        /* 기본값 */
      }
      ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('2'), interval);
    } else if (data === '40') {
      onEvent({ type: 'sent' });
    } else if (data.startsWith('42')) {
      let name = '';
      let payload: unknown;
      try {
        [name, payload] = JSON.parse(data.slice(2)) as [string, unknown];
      } catch {
        return;
      }
      if (name === 'authorized') finish({ type: 'authorized' });
      else if (name === 'error') finish(errorOf(payload));
    } else if (data.startsWith('44')) {
      // socket.io 오류 패킷
      let payload: unknown;
      try {
        payload = JSON.parse(data.slice(2));
      } catch {
        /* 내용 없음 */
      }
      finish(errorOf(payload));
    }
  };
  ws.onerror = () => finish({ type: 'error', noPhone: false });
  ws.onclose = () => finish({ type: 'closed' });

  return { close: () => finish({ type: 'closed' }) };
}

function errorOf(payload: unknown): RuauthEvent {
  const o = payload && typeof payload === 'object' ? (payload as { code?: unknown; message?: unknown }) : {};
  const message = typeof o.message === 'string' && o.message.length <= 120 ? o.message : undefined;
  return { type: 'error', noPhone: Number(o.code) === 200, message };
}

/** 알림톡으로 받은 인증코드 형식 (숫자·영문만) */
export const isKakaoCode = (code: string): boolean => /^[A-Za-z0-9]{4,12}$/.test(code);

/**
 * 받은 인증코드를 ruauth 에 보낸다. 맞으면 열려 있는 소켓에 'authorized' 가 온다
 * (응답 본문으로는 성공을 판단하지 않는다 — 인증 화면도 그렇게 한다).
 */
export async function submitKakaoCode(code: string): Promise<void> {
  if (!isKakaoCode(code)) throw new Error('인증코드는 숫자와 영문만 넣어 주세요.');
  const res = await fetch(`${RUAUTH_ORIGIN}/api/v1/code/${encodeURIComponent(code)}`, { method: 'POST' });
  if (!res.ok) throw new Error('인증코드를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
}
