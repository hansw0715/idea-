import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';
import { AppHeader } from '../shell/Shell';
import { cacheKey, startKeyDerivation } from '../school/loginKey';
import { Alert, Button, PasswordField, Reveal, TextField, btnClass } from '../ui';
import './auth.css';

const ID_FIELD = 'login-id';
const PW_FIELD = 'login-password';

/**
 * 로그인: 플랫폼 아이디 + 비밀번호. 탭바 없는 한 컬럼 화면.
 * 로그인에 성공하면 같은 아이디·비밀번호로 학교 계정 암호 키를 이 기기에서 만들어 둔다(서버에는 보내지 않는다) —
 * 그래서 새 기기에서 로그인해도 학교 연동이 이어진다.
 */
export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [idError, setIdError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState('로그인 중…');
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // 제출 실패 안내가 화면 밖에 있지 않도록 안으로 가져온다 (키보드가 올라와 있어도 보이게).
  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  // 첫 오류 입력칸으로 포커스를 옮긴다.
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const nextIdError = identifier.trim() ? null : '아이디를 입력해 주세요. 계정을 확인하는 데 필요합니다.';
    const nextPwError = password ? null : '비밀번호를 입력해 주세요. 본인 확인에 필요합니다.';
    setIdError(nextIdError);
    setPwError(nextPwError);
    if (nextIdError || nextPwError) {
      setFocusTarget(nextIdError ? ID_FIELD : PW_FIELD);
      return;
    }

    setPending(true);
    setPendingLabel('로그인 중…');
    try {
      // 키 만들기(약 1초)는 서버 확인과 나란히 시작해 기다림을 겹친다. 서버가 허락한 뒤에만 이 기기에 둔다.
      const keyPromise = startKeyDerivation(identifier, password);
      const user = await api.post<User>('/auth/login', { username: identifier.trim(), password });
      setPendingLabel('보안 열쇠를 만드는 중…');
      cacheKey(user.id, await keyPromise);
      setUser(user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AppHeader bare />
      <main id="main" className="app-main auth-main auth-split">
        <Reveal className="auth-hero">
          <img className="auth-hero__mark" src="/brand/mark.png" alt="" width="56" height="56" />
          <p className="auth-hero__brand">
            상상Book<i>-</i>E
          </p>
          <p className="auth-hero__slogan">
            예약도, 팀도,
            <br />
            상상처럼<i>.</i>
          </p>
          <p className="auth-hero__sub">한성 캠퍼스의 시간표 · 회의실 · 사람을 한곳에서.</p>
          {/* 넓은 화면에서만 보이는 기능 목차 — 왼쪽 판의 빈 자리를 인쇄물 목차처럼 채운다 */}
          <ol className="auth-index" aria-label="상상Book-E로 할 수 있는 일">
            <li><span className="mono">01</span>시간표를 모아 빈 시간 찾기</li>
            <li><span className="mono">02</span>회의실 예약과 팀 회의</li>
            <li><span className="mono">03</span>라운지에서 밥약 · 미팅</li>
          </ol>
        </Reveal>

        <div className="auth-split__form">
        <Reveal delay={0.08} className="auth-card" role="region" aria-labelledby="login-title">
          <h1 className="auth-card__title" id="login-title">
            로그인
          </h1>

          {error && (
            <div className="auth-alert" ref={alertRef}>
              <Alert tone="danger" title="로그인하지 못했습니다.">
                {error}
              </Alert>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <TextField
              id={ID_FIELD}
              name="username"
              label="아이디"
              required
              size="lg"
              type="text"
              placeholder="아이디"
              error={idError}
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setIdError(null);
              }}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
            <PasswordField
              id={PW_FIELD}
              name="password"
              label="비밀번호"
              required
              size="lg"
              placeholder="비밀번호"
              error={pwError}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPwError(null);
              }}
              autoComplete="current-password"
              enterKeyHint="go"
            />
            <Button type="submit" size="lg" block loading={pending}>
              {pending ? pendingLabel : '로그인'}
            </Button>
          </form>
        </Reveal>

        <div className="auth-foot">
          <span>아직 계정이 없나요?</span>
          <Link to="/signup" className={btnClass({ variant: 'text' })}>
            회원가입
          </Link>
        </div>
        </div>
      </main>
    </>
  );
}
