import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const user = await api.post<User>('/auth/login', { email, password });
      setUser(user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
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
        <h1 className="auth-title">캠퍼스 스페이스</h1>
        <p className="auth-sub">시간표를 모아 함께 모일 시간과 공간을 찾아보세요.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              className="input"
              type="text"
              placeholder="학번 또는 이메일 주소"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <p className="row-sub" style={{ marginTop: 6 }}>
              @hansung.ac.kr 은 생략해도 됩니다.
            </p>
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              className="input"
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending}>
            {pending ? '로그인 중…' : '로그인'}
          </button>
        </form>
        <p className="auth-foot">
          아직 계정이 없나요? <Link to="/signup">회원가입</Link>
        </p>
      </div>
    </div>
  );
}
