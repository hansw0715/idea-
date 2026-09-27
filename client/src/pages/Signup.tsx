import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';

const DOMAIN = 'hansung.ac.kr';
const CODE_TTL_SEC = 10 * 60;

export default function Signup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [localPart, setLocalPart] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  const email = `${localPart.trim()}@${DOMAIN}`;

  // 남은 유효 시간 표시
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(
    secondsLeft % 60,
  ).padStart(2, '0')}`;

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await api.post('/auth/request-code', { email });
      setStep('verify');
      setSecondsLeft(CODE_TTL_SEC);
      setNotice(`${email} 으로 인증코드를 보냈습니다. 10분 안에 입력해 주세요.`);
      window.setTimeout(() => codeRef.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '인증 메일을 보내지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    setPending(true);
    try {
      const user = await api.post<User>('/auth/signup', { email, name, password, code });
      setUser(user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원가입에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="logo-mark" />
        </div>
        <h1 className="auth-title">회원가입</h1>
        <p className="auth-sub">한성대학교 이메일로만 가입할 수 있습니다.</p>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-info">{notice}</div>}

        {step === 'email' ? (
          <form onSubmit={requestCode}>
            <div className="field">
              <label htmlFor="local">학교 이메일</label>
              <div className="email-row">
                <input
                  id="local"
                  className="input"
                  type="text"
                  placeholder="학번 또는 아이디"
                  value={localPart}
                  onChange={(e) => setLocalPart(e.target.value.replace(/[@\s]/g, ''))}
                  autoComplete="username"
                  required
                />
                <span className="email-domain">@{DOMAIN}</span>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={pending || localPart.trim().length === 0}
            >
              {pending ? '보내는 중…' : '인증 메일 받기'}
            </button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="code">
                인증코드{' '}
                <span style={{ color: secondsLeft > 0 ? 'var(--slate-3)' : 'var(--danger)' }}>
                  {secondsLeft > 0 ? `· 남은 시간 ${mmss}` : '· 만료됨'}
                </span>
              </label>
              <input
                id="code"
                ref={codeRef}
                className="input code-badge"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6자리 숫자"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ marginTop: 8 }}
                onClick={requestCode}
                disabled={pending}
              >
                코드 다시 받기
              </button>
            </div>
            <div className="field">
              <label htmlFor="name">이름</label>
              <input
                id="name"
                className="input"
                type="text"
                placeholder="이름 (2자 이상)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                className="input"
                type="password"
                placeholder="8자 이상"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">비밀번호 확인</label>
              <input
                id="confirm"
                className="input"
                type="password"
                placeholder="비밀번호 다시 입력"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending}>
              {pending ? '가입 중…' : '가입하기'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              style={{ marginTop: 8 }}
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
                setNotice(null);
              }}
            >
              이메일 다시 입력
            </button>
          </form>
        )}

        <p className="auth-foot">
          이미 계정이 있나요? <Link to="/login">로그인</Link>
        </p>
      </div>
    </div>
  );
}
