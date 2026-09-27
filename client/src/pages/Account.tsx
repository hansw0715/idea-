import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/** 실수로 누르는 것을 막기 위해 그대로 입력해야 하는 확인 문구 */
const CONFIRM_PHRASE = '탈퇴합니다';

export default function Account() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isAdmin = Boolean(user?.isAdmin);
  const ready = password.length > 0 && phrase.trim() === CONFIRM_PHRASE;

  function cancel() {
    setOpen(false);
    setPassword('');
    setPhrase('');
    setError(null);
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setPending(true);
    try {
      await api.del('/auth/me', { password });
      setUser(null);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '탈퇴 처리에 실패했습니다.');
      setPending(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">내 계정</h1>
      <p className="page-sub">가입 정보를 확인하고 계정을 정리할 수 있습니다.</p>

      <div className="card">
        <h2 className="card-title">가입 정보</h2>
        <div className="row-item">
          <div className="grow">
            <div className="row-sub">이름</div>
            <div className="row-main">{user?.name}</div>
          </div>
        </div>
        <div className="row-item">
          <div className="grow">
            <div className="row-sub">학교 이메일</div>
            <div className="row-main">{user?.email}</div>
          </div>
          {isAdmin && <span className="badge badge-neutral">관리자</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">회원 탈퇴</h2>

        {isAdmin ? (
          <p className="empty-note">
            운영을 위해 미리 만들어 둔 관리자 계정은 탈퇴할 수 없습니다. 회원가입으로 만든 계정에서만
            탈퇴가 가능합니다.
          </p>
        ) : (
          <>
            <p className="row-sub" style={{ lineHeight: 1.7, marginBottom: 16 }}>
              탈퇴하면 <strong>시간표, 회의 참여 기록, 예약이 모두 삭제</strong>되고 되돌릴 수 없습니다.
              내가 만든 회의에 다른 참여자가 남아 있으면 가장 먼저 참여한 사람에게 넘어가고, 아무도 없으면
              회의도 함께 사라집니다.
            </p>

            {!open ? (
              <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
                회원 탈퇴
              </button>
            ) : (
              <form onSubmit={withdraw}>
                {error && <div className="alert alert-error">{error}</div>}
                <div className="field">
                  <label htmlFor="withdraw-password">비밀번호</label>
                  <input
                    id="withdraw-password"
                    className="input"
                    type="password"
                    placeholder="본인 확인을 위해 다시 입력해 주세요"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="withdraw-phrase">확인 문구</label>
                  <input
                    id="withdraw-phrase"
                    className="input"
                    type="text"
                    placeholder={CONFIRM_PHRASE}
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    required
                  />
                  <p className="row-sub" style={{ marginTop: 6 }}>
                    확인을 위해 <strong>{CONFIRM_PHRASE}</strong> 를 그대로 입력해 주세요.
                  </p>
                </div>
                <div className="form-row">
                  <button type="button" className="btn btn-outline" onClick={cancel} disabled={pending}>
                    취소
                  </button>
                  <button type="submit" className="btn btn-danger-text" disabled={!ready || pending}>
                    {pending ? '탈퇴 처리 중…' : '탈퇴하기'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
