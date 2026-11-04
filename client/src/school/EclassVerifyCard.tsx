/**
 * e-class 원격수업 본인 인증(7일마다) 안내 + 카카오 알림톡 인증을 앱 안에서 진행하는 한 줄 안내.
 * 경고 상자 없이 불러오기 안내(.school-eclass__notice)와 같은 모양: 회색 한 줄 + 오른쪽 글자 버튼.
 *
 * - [카톡 인증]을 누르면 ruauth 에 붙어 알림톡이 학생 휴대폰으로 간다(ruauth.ts).
 * - 학생이 받은 인증코드를 여기에 넣거나 알림톡 링크를 누르면 인증된다. 앱이 뒤로 가 있어 소켓이 끊겼을 수 있으니
 *   [링크로 인증했어요]로 서버가 e-class 에 직접 물어볼 수도 있다.
 * - 인증이 확인되면 onVerified() (화면이 e-class 를 다시 읽는다).
 */
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { EclassVerification } from "../../../shared/school/eclass";
import { Icon } from "../ui";
import { schoolApi } from "./api";
import { schoolErrorMessage } from "./errors";
import { isKakaoCode, startKakaoAuth, submitKakaoCode } from "./ruauth";
import type { RuauthSession } from "./ruauth";
import { useSchool } from "./SchoolContext";

type Step = "idle" | "connecting" | "sent" | "confirming";

export default function EclassVerifyCard({
  verification,
  onVerified,
}: {
  verification: EclassVerification;
  onVerified: () => void;
}) {
  const school = useSchool();
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const session = useRef<RuauthSession | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.current?.close();
    };
  }, []);

  const confirm = async () => {
    setStep("confirming");
    setMessage(null);
    try {
      const { verified } = await school.withCredentials((creds) =>
        schoolApi.eclassVerify(creds, verification),
      );
      if (!alive.current) return;
      if (verified) {
        session.current?.close();
        onVerified();
        return;
      }
      setMessage("아직 인증되지 않았어요. 링크를 누르거나 인증코드를 넣어 주세요.");
      setStep("sent");
    } catch (err) {
      if (!alive.current) return;
      setMessage(schoolErrorMessage(err));
      setStep("sent");
    }
  };

  const start = () => {
    session.current?.close();
    setMessage(null);
    setCode("");
    setStep("connecting");
    session.current = startKakaoAuth(verification, (e) => {
      if (!alive.current) return;
      if (e.type === "sent") setStep("sent");
      else if (e.type === "authorized") {
        session.current = null;
        void confirm();
      } else if (e.type === "error") {
        session.current = null;
        setStep("idle");
        setMessage(
          e.message
            ? `알림톡을 보내지 못했어요: ${e.message}`
            : e.noPhone
              ? "학교에 등록된 휴대폰 번호가 없어 알림톡을 보낼 수 없어요. e-class에서 다른 방법으로 인증해 주세요."
              : "알림톡을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      } else {
        // 끊김: 코드 입력·링크 인증이 이미 끝났을 수 있으니 입력 화면은 그대로 둔다
        session.current = null;
        setStep((s) => (s === "connecting" ? "idle" : s));
      }
    });
  };

  const cancel = () => {
    session.current?.close();
    session.current = null;
    setMessage(null);
    setStep("idle");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!isKakaoCode(value)) {
      setMessage("카톡으로 받은 인증코드를 그대로 넣어 주세요.");
      return;
    }
    setMessage(null);
    try {
      await submitKakaoCode(value);
      // 맞으면 소켓으로 'authorized' 가 온다. 소켓이 끊겼으면 직접 확인한다
      if (!session.current) void confirm();
    } catch (err) {
      if (alive.current) setMessage(err instanceof Error ? err.message : "인증코드를 보내지 못했어요.");
    }
  };

  const n = verification.courses.length;
  const busy = step === "confirming";

  return (
    <div className="school-eclass__verify">
      {step === "idle" || step === "connecting" ? (
        <div className="school-eclass__notice">
          <Icon name="shield" className="school-eclass__notice-icon school-eclass__verify-icon" />
          <p className="school-eclass__notice-text" title={verification.courses.join(", ")}>
            원격수업 {n}개 강좌는 본인 인증(7일마다) 후에 보여요
          </p>
          <button
            type="button"
            className="school-eclass__textbtn"
            disabled={step === "connecting" || !school.canUse}
            onClick={start}
          >
            {step === "connecting" ? "보내는 중" : "카톡 인증"}
          </button>
        </div>
      ) : (
        <form className="school-eclass__verify-form" onSubmit={(e) => void submit(e)}>
          <div className="school-eclass__notice">
            <Icon name="message" className="school-eclass__notice-icon" />
            <p className="school-eclass__notice-text">
              {busy ? "인증을 확인하는 중이에요" : "카톡으로 받은 인증코드를 넣거나 링크를 눌러 주세요"}
            </p>
          </div>
          <div className="school-eclass__verify-code">
            <input
              className="input"
              aria-label="인증코드"
              placeholder="인증코드"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !code.trim()}>
              확인
            </button>
          </div>
          <div className="school-eclass__verify-links">
            <button type="button" className="school-eclass__textbtn school-eclass__refresh" disabled={busy} onClick={() => void confirm()}>
              링크로 인증했어요
            </button>
            <button type="button" className="school-eclass__textbtn school-eclass__refresh" disabled={busy} onClick={start}>
              다시 보내기
            </button>
            <button type="button" className="school-eclass__textbtn school-eclass__refresh" disabled={busy} onClick={cancel}>
              닫기
            </button>
          </div>
        </form>
      )}
      {message && <p className="school-eclass__notice-text school-eclass__verify-msg">{message}</p>}
    </div>
  );
}
