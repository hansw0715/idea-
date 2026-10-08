import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';
import { AppHeader } from '../shell/Shell';
import {
  Alert,
  Button,
  Icon,
  PasswordField,
  Stepper,
  TextField,
  btnClass,
  useToast,
} from '../ui';
import './auth.css';

const DOMAIN = 'hansung.ac.kr';
/** 인증코드 유효 시간 (서버와 같은 10분) */
const CODE_TTL_MS = 10 * 60 * 1000;
const STEPS = ['이메일 확인', '정보 입력'];

const ID = {
  local: 'signup-local',
  code: 'signup-code',
  name: 'signup-name',
  password: 'signup-password',
  confirm: 'signup-confirm',
} as const;

/** 서버가 받는 @ 앞부분 글자 (영문·숫자·. _ % + -). 한글처럼 서버가 거절할 글자는 보내기 전에 알려 준다. */
const LOCAL_PART_RE = /^[A-Za-z0-9._%+-]+$/;

type FieldKey = 'local' | 'code' | 'name' | 'password' | 'confirm';
type FieldErrors = Partial<Record<FieldKey, string>>;

/** 1단계 입력 검사. 문제가 없으면 null. */
function checkLocalPart(value: string): string | null {
  if (value.length === 0) {
    return '학교 이메일을 입력해 주세요. 인증 메일을 받을 주소가 필요합니다.';
  }
  if (!LOCAL_PART_RE.test(value)) {
    return '학번 또는 아이디에 쓸 수 없는 글자가 있습니다. 영문, 숫자, 점, 밑줄, 하이픈으로 입력해 주세요.';
  }
  return null;
}

interface SubmitError {
  title: string;
  message: string;
  status: number | null;
}

function toSubmitError(err: unknown, title: string, fallback: string): SubmitError {
  return {
    title,
    message: err instanceof Error ? err.message : fallback,
    status: err instanceof ApiError ? err.status : null,
  };
}

/** 회원가입 2단계: ① 학교 이메일로 인증코드 받기 → ② 코드·이름·비밀번호 입력 */
export default function Signup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [localPart, setLocalPart] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<SubmitError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  /** 인증코드가 만료되는 시각. 앱을 잠시 떠나도 맞도록 남은 초를 줄여 가지 않고 시각으로 계산한다. */
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const email = `${localPart.trim()}@${DOMAIN}`;
  const busy = sending || signingUp;

  // ── 남은 유효 시간 ─────────────────────────────────────────
  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= expiresAt) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1000);
    // 메일 앱에 다녀오느라 화면이 멈췄던 경우 돌아오자마자 바로잡는다.
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [expiresAt]);

  const secondsLeft = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = step === 'verify' && expiresAt !== null && secondsLeft === 0;
  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(
    secondsLeft % 60,
  ).padStart(2, '0')}`;
  // 스크린 리더에는 매초가 아니라 1분 단위와 만료 때만 알린다 (문장이 바뀔 때만 읽힌다).
  const minutesLeft = Math.ceil(secondsLeft / 60);
  const announcement = expired
    ? '인증코드가 만료되었습니다. 코드 다시 받기를 눌러 새 코드를 받아 주세요.'
    : minutesLeft <= 1
      ? '인증코드 남은 시간이 1분 이내입니다.'
      : `인증코드 남은 시간은 ${minutesLeft}분입니다.`;

  // ── 포커스·스크롤 ──────────────────────────────────────────
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function clearFieldError(key: FieldKey) {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  // ── 1단계 / 코드 다시 받기 ─────────────────────────────────
  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const resend = step === 'verify';
    setError(null);
    setNotice(null);
    if (!resend) {
      // 비워 두거나 쓸 수 없는 글자가 있으면 메일을 보내기 전에 입력칸에서 알려 준다.
      const problem = checkLocalPart(localPart.trim());
      setFieldErrors((prev) => ({ ...prev, local: problem ?? undefined }));
      if (problem) {
        setFocusTarget(ID.local);
        return;
      }
    }
    setSending(true);
    try {
      await api.post('/auth/request-code', { email });
      setStep('verify');
      setExpiresAt(Date.now() + CODE_TTL_MS);
      setNow(Date.now());
      setNotice(`${email}로 인증코드를 보냈습니다. 10분 안에 입력해 주세요.`);
      if (resend) toast('인증코드를 다시 보냈습니다.');
      setFocusTarget(ID.code);
    } catch (err) {
      setError(toSubmitError(err, '인증 메일을 요청하지 못했습니다.', '인증 메일을 보내지 못했습니다.'));
    } finally {
      setSending(false);
    }
  }

  // ── 2단계: 가입 ────────────────────────────────────────────
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const trimmedName = name.trim();
    const next: FieldErrors = {};
    if (!/^\d{6}$/.test(code)) {
      next.code = '인증코드가 6자리가 아닙니다. 메일로 받은 숫자 6자리를 입력해 주세요.';
    }
    if (trimmedName.length < 2 || trimmedName.length > 20) {
      next.name = '이름은 2자 이상 20자 이하로 입력해 주세요.';
    }
    if (password.length < 8) {
      next.password = '비밀번호가 너무 짧습니다. 8자 이상으로 입력해 주세요.';
    }
    if (password.length > 0 && confirm.length === 0) {
      next.confirm = '비밀번호를 한 번 더 입력해 주세요.';
    } else if (confirm.length > 0 && password !== confirm) {
      next.confirm = '비밀번호가 서로 일치하지 않습니다. 같은 비밀번호를 다시 입력해 주세요.';
    }
    setFieldErrors(next);
    const first = (['code', 'name', 'password', 'confirm'] as const).find((k) => next[k]);
    if (first) {
      setFocusTarget(ID[first]);
      return;
    }

    setSigningUp(true);
    try {
      const user = await api.post<User>('/auth/signup', {
        email,
        name: trimmedName,
        password,
        code,
      });
      setUser(user);
      navigate('/');
    } catch (err) {
      setError(toSubmitError(err, '가입하지 못했습니다.', '회원가입에 실패했습니다.'));
    } finally {
      setSigningUp(false);
    }
  }

  function backToEmail() {
    setStep('email');
    setCode('');
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setExpiresAt(null);
    setFocusTarget(ID.local);
  }

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main">
        <img
          className="auth-logo auth-logo--sm"
          src="/brand/logo.png"
          alt="상상Book-E"
          width="720"
          height="559"
        />
        <div className="page-head">
          <h1 className="page-title">회원가입</h1>
          <p className="page-lead">
            {step === 'email'
              ? '한성대학교 이메일로만 가입할 수 있습니다.'
              : '메일로 받은 인증코드와 가입 정보를 입력해 주세요.'}
          </p>
        </div>

        <div className="auth-steps">
          <Stepper steps={STEPS} current={step === 'email' ? 1 : 2} />
        </div>

        {notice && (
          <div className="auth-alert">
            <Alert tone="info">{notice}</Alert>
          </div>
        )}

        {error && (
          <div className="auth-alert" ref={alertRef}>
            <Alert
              tone="danger"
              title={error.title}
              actions={
                error.status === 409 ? (
                  <Link to="/login" className={btnClass({ variant: 'secondary' })}>
                    로그인하기
                  </Link>
                ) : undefined
              }
            >
              {error.message}
            </Alert>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={requestCode} noValidate>
            <TextField
              id={ID.local}
              name="username"
              label="학교 이메일"
              required
              size="lg"
              type="text"
              suffix={`@${DOMAIN}`}
              placeholder="학번 또는 아이디"
              help="학교 이메일은 한성대학교 재학생 확인과 로그인에 사용합니다. @ 앞부분만 입력해 주세요."
              error={fieldErrors.local}
              value={localPart}
              onChange={(e) => {
                // 주소 전체를 붙여 넣어도 @ 앞부분만 남기고, 공백은 지운다.
                const raw = e.target.value;
                const head = raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw;
                setLocalPart(head.replace(/\s/g, ''));
                clearFieldError('local');
              }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
            />
            <Button type="submit" size="lg" block loading={sending}>
              {sending ? '보내는 중…' : '인증 메일 받기'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="auth-code">
              <TextField
                id={ID.code}
                name="code"
                label="인증코드"
                required
                size="lg"
                className="code-chip auth-code__input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6자리 숫자"
                error={fieldErrors.code}
                value={code}
                onChange={(e) => {
                  // maxLength 속성은 "123 456" 처럼 공백이 낀 붙여넣기에서 끝자리를 잘라 먹으므로,
                  // 숫자만 남긴 뒤 6자리로 자른다.
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  clearFieldError('code');
                }}
                enterKeyHint="next"
              />
              <div className="auth-code__meta">
                <p className={`auth-timer${expired ? ' auth-timer--expired' : ''}`}>
                  <Icon name={expired ? 'alert' : 'clock'} />
                  <span aria-hidden="true">{expired ? '만료됨' : `남은 시간 ${mmss}`}</span>
                </p>
                <Button
                  variant={expired ? 'secondary' : 'tertiary'}
                  loading={sending}
                  disabled={busy}
                  onClick={() => void requestCode()}
                >
                  {sending ? '보내는 중…' : '코드 다시 받기'}
                </Button>
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {announcement}
              </p>
            </div>

            <TextField
              id={ID.name}
              name="name"
              label="이름"
              required
              size="lg"
              type="text"
              placeholder="이름 (2자 이상)"
              help="이름은 회의에서 다른 참여자에게 보여 주기 위해 받습니다. 2자 이상 20자 이하로 입력해 주세요."
              error={fieldErrors.name}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError('name');
              }}
              autoComplete="name"
              enterKeyHint="next"
            />
            <PasswordField
              id={ID.password}
              name="new-password"
              label="비밀번호"
              required
              size="lg"
              placeholder="8자 이상"
              help="8자 이상으로 입력해 주세요."
              error={fieldErrors.password}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError('password');
                clearFieldError('confirm');
              }}
              autoComplete="new-password"
              enterKeyHint="next"
            />
            <PasswordField
              id={ID.confirm}
              name="confirm-password"
              label="비밀번호 확인"
              required
              size="lg"
              placeholder="비밀번호 다시 입력"
              error={fieldErrors.confirm}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                clearFieldError('confirm');
              }}
              autoComplete="new-password"
              enterKeyHint="go"
            />

            <div className="auth-actions">
              <Button type="submit" size="lg" block loading={signingUp} disabled={sending}>
                {signingUp ? '가입 중…' : '가입하기'}
              </Button>
              <Button variant="tertiary" block disabled={busy} onClick={backToEmail}>
                이메일 다시 입력
              </Button>
            </div>
          </form>
        )}

        <div className="auth-foot">
          <span>이미 계정이 있나요?</span>
          <Link to="/login" className={btnClass({ variant: 'text' })}>
            로그인
          </Link>
        </div>
      </main>
    </>
  );
}
