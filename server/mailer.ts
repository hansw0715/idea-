import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { isServerless } from './db.js';

/**
 * 인증 메일 발송.
 * SMTP 정보가 없으면 개발 중에는 콘솔에 코드를 찍고, 배포 환경에서는 오류를 낸다.
 * (설정이 빠진 채 배포되면 아무도 가입할 수 없으므로 조용히 넘어가면 안 된다)
 */
const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER;
// Gmail 앱 비밀번호는 'abcd efgh ijkl mnop' 처럼 4칸씩 띄어 표시된다.
// 그대로 붙여넣는 경우가 많으므로 공백을 걸러 낸다.
const PASS = process.env.SMTP_PASS?.replace(/\s/g, '');
const FROM = process.env.MAIL_FROM ?? (USER ? `캠퍼스 스페이스 <${USER}>` : '');

export const mailConfigured = Boolean(HOST && USER && PASS);

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      // 465는 SSL, 그 외(587 등)는 STARTTLS
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

/**
 * SMTP 로그인이 되는지만 확인한다. 메일은 보내지 않는다.
 * 비밀번호는 물론 호스트/계정도 돌려주지 않고, 실패 원인 코드만 알려준다.
 */
export async function verifyMailConnection(): Promise<{
  configured: boolean;
  ok: boolean;
  code?: string;
  message?: string;
}> {
  if (!mailConfigured) {
    return {
      configured: false,
      ok: false,
      message: [
        HOST ? null : 'SMTP_HOST',
        USER ? null : 'SMTP_USER',
        PASS ? null : 'SMTP_PASS',
      ]
        .filter(Boolean)
        .join(', ') + ' 없음',
    };
  }
  try {
    await getTransporter().verify();
    return { configured: true, ok: true };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { configured: true, ok: false, code: e.code, message: e.message };
  }
}

export async function sendVerificationCode(to: string, code: string): Promise<void> {
  if (!mailConfigured) {
    if (isServerless) {
      throw new Error(
        '메일 발송 설정(SMTP_HOST/SMTP_USER/SMTP_PASS)이 없어 인증 메일을 보낼 수 없습니다.',
      );
    }
    console.warn(`[mail] SMTP 미설정 — ${to} 인증코드: ${code}`);
    return;
  }

  await getTransporter().sendMail({
    from: FROM,
    to,
    subject: '[캠퍼스 스페이스] 이메일 인증코드',
    text: `인증코드는 ${code} 입니다. 10분 안에 입력해 주세요.`,
    html: `
      <div style="font-family:'Apple SD Gothic Neo',Pretendard,sans-serif;color:#262626;line-height:1.6">
        <h2 style="font-size:20px;margin:0 0 12px">이메일 인증코드</h2>
        <p style="margin:0 0 16px;color:#4c4c4c">
          캠퍼스 스페이스 회원가입을 위해 아래 6자리 숫자를 입력해 주세요.
        </p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#2a72e5;margin:16px 0">
          ${code}
        </div>
        <p style="margin:0;color:#5d5d5d;font-size:14px">
          이 코드는 <strong>10분</strong> 동안만 사용할 수 있습니다.<br />
          본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.
        </p>
      </div>
    `,
  });
}
