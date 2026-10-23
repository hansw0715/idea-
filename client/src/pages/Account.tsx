import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AppHeader } from '../shell/Shell';
import { LOUNGE_ENABLED } from '../features';
import LoungeProfileCard from '../lounge/account/LoungeProfileCard';
import LoungeAccountRows from '../lounge/account/LoungeAccountRows';
import SchoolLinkCard from '../school/SchoolLinkCard';
import { useSchool } from '../school/SchoolContext';
import {
  Alert,
  Badge,
  Button,
  Icon,
  PasswordField,
  btnClass,
  TextField,
  useConfirm,
  useDisplay,
  useToast,
} from '../ui';
import './account.css';

/** 실수로 누르는 것을 막기 위해 그대로 입력해야 하는 확인 문구 */
const CONFIRM_PHRASE = '탈퇴합니다';

const OPEN_BUTTON = 'withdraw-open';
const PASSWORD_FIELD = 'withdraw-password';
const PHRASE_FIELD = 'withdraw-phrase';

/** 내 정보: 가입 정보 · 로그아웃 · 회원 탈퇴 */
export default function Account() {
  const { user, setUser } = useAuth();
  const { dark, setDark } = useDisplay();
  const school = useSchool();
  // 학번 전체는 이 기기에 암호화해 둔 학교 계정 정보를 기기 안에서만 잠깐 풀어 보여 준다 (서버에는 학번 원문이 없다).
  // 풀 수 없는 기기(다른 기기에서 연동 등)에서는 가린 학번(hint)만 보인다.
  const [studentId, setStudentId] = useState<string | null>(null);
  useEffect(() => {
    if (!school.linked || !school.canUse) {
      setStudentId(null);
      return;
    }
    let cancelled = false;
    school
      .withCredentials(async (c) => c.studentId)
      .then((id) => !cancelled && setStudentId(id))
      .catch(() => !cancelled && setStudentId(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.linked, school.canUse]);
  const studentIdText = studentId ?? school.hint;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const [loggingOut, setLoggingOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const isAdmin = Boolean(user?.isAdmin);
  const ready = password.length > 0 && phrase.trim() === CONFIRM_PHRASE;

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
    } catch {
      // 서버에 닿지 못해도 이 기기의 로그인 상태는 정리하고 로그인 화면으로 보낸다.
    }
    setUser(null);
    toast('로그아웃했습니다.');
    navigate('/login', { replace: true });
  }

  function openWithdraw() {
    setOpen(true);
    setFocusTarget(PASSWORD_FIELD);
  }

  function cancelWithdraw() {
    setOpen(false);
    setPassword('');
    setPhrase('');
    setError(null);
    setFocusTarget(OPEN_BUTTON);
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    const result: { failure: string | null } = { failure: null };
    const done = await confirm({
      title: '정말 탈퇴하시겠습니까?',
      message:
        '탈퇴하면 시간표, 회의 참여 기록, 예약이 모두 삭제되고 되돌릴 수 없습니다. 탈퇴를 진행할까요?',
      tone: 'danger',
      confirmLabel: '탈퇴하기',
      run: async () => {
        try {
          await api.del('/auth/me', { password });
        } catch (err) {
          result.failure = err instanceof Error ? err.message : '탈퇴 처리에 실패했습니다.';
          throw err;
        }
      },
    });
    if (done) {
      setUser(null);
      toast('탈퇴 처리를 마쳤습니다.');
      navigate('/login', { replace: true });
      return;
    }
    // 다이얼로그에서 실패를 본 뒤 닫았다면, 폼에도 같은 안내를 남기고 비밀번호 칸으로 돌아온다.
    if (result.failure) {
      setError(result.failure);
      setFocusTarget(PASSWORD_FIELD);
    }
  }


  return (
    <>
      <AppHeader />
      <main id="main" className="app-main">
        <div className="page-head">
          <h1 className="page-title">내 정보</h1>
          <p className="page-lead">가입 정보를 확인하고 계정을 관리합니다.</p>
        </div>

        <section className="section" aria-labelledby="account-info-title">
          <div className="card">
            <div className="account-card-head">
              <h2 className="card__title" id="account-info-title">
                가입 정보
              </h2>
              {isAdmin && <Badge tone="gray">관리자</Badge>}
            </div>
            <dl className="account-info">
              <div className="account-info__row">
                <dt className="account-info__key">이름</dt>
                <dd className="account-info__val account-info__val--name">{user?.name}</dd>
              </div>
              {studentIdText && (
                <div className="account-info__row">
                  <dt className="account-info__key">학번</dt>
                  <dd className="account-info__val tabular">{studentIdText}</dd>
                </div>
              )}
              <div className="account-info__row">
                <dt className="account-info__key">아이디</dt>
                <dd className="account-info__val">{user?.username}</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 라운지 프로필 → 학교 계정 연동 (C4/C5). 학교 카드는 자기 안에서 제목·여백을 맡는다. */}
        {LOUNGE_ENABLED && <LoungeProfileCard />}
        {/* 학교 계정 카드는 연동이 필요할 때만 (연동 전·다시 연동). 연동이 끝났으면 보이지 않는다 */}
        {!(school.linked && school.canUse) && (
          <div className="section lounge-acct-school">
            <SchoolLinkCard />
          </div>
        )}

        <section className="section account-tools" aria-label="설정">
          <button
            type="button"
            className={btnClass({ variant: 'secondary', size: 'sm' })}
            onClick={() => setDark(!dark)}
          >
            <Icon name={dark ? 'sun' : 'moon'} className="btn__icon" />
            {dark ? '화이트 모드' : '다크 모드'}
          </button>
          {LOUNGE_ENABLED && <LoungeAccountRows />}
        </section>

        <section className="section account-logout">
          <Button variant="tertiary" block loading={loggingOut} onClick={logout}>
            {!loggingOut && <Icon name="logout" className="btn__icon" />}
            {loggingOut ? '로그아웃 중…' : '로그아웃'}
          </Button>
        </section>

        <section className="section account-danger" aria-labelledby="account-withdraw-title">
          <div className="section__head">
            <h2 className="section__title" id="account-withdraw-title">
              회원 탈퇴
            </h2>
          </div>

          {isAdmin ? (
            <Alert tone="info">
              운영을 위해 미리 만들어 둔 관리자 계정은 탈퇴할 수 없습니다. 회원가입으로 만든 계정에서만
              탈퇴할 수 있습니다.
            </Alert>
          ) : (
            <>
              <p className="account-danger__text">
                탈퇴하면 <strong>시간표, 회의 참여 기록, 예약이 모두 삭제</strong>되고 되돌릴 수 없습니다. 또한
                탈퇴한 학번으로는 <strong>다시 가입할 수 없습니다.</strong> 다시 이용하려면 관리자에게 문의해
                주세요.
              </p>

              {!open ? (
                <Button
                  id={OPEN_BUTTON}
                  variant="danger"
                  block
                  className="account-danger__open"
                  onClick={openWithdraw}
                >
                  회원 탈퇴
                </Button>
              ) : (
                <form id="withdraw-form" className="account-danger__form" onSubmit={withdraw} noValidate>
                  {error && (
                    <div className="account-alert" ref={errorRef}>
                      <Alert tone="danger" title="탈퇴하지 못했습니다.">
                        {error}
                      </Alert>
                    </div>
                  )}
                  <PasswordField
                    id={PASSWORD_FIELD}
                    name="password"
                    label="비밀번호"
                    required
                    help="본인 확인을 위해 현재 비밀번호를 다시 입력해 주세요."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    enterKeyHint="next"
                  />
                  <TextField
                    id={PHRASE_FIELD}
                    name="confirm-phrase"
                    label="확인 문구"
                    required
                    placeholder={CONFIRM_PHRASE}
                    help={
                      <>
                        확인을 위해 <strong>{CONFIRM_PHRASE}</strong>를 그대로 입력해 주세요.
                      </>
                    }
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                  />
                  {!ready && (
                    <p className="field__help account-danger__hint" id="withdraw-hint">
                      비밀번호와 확인 문구를 모두 입력하면 탈퇴하기를 누를 수 있습니다.
                    </p>
                  )}
                  <div className="form-actions">
                    <Button variant="tertiary" onClick={cancelWithdraw}>
                      취소
                    </Button>
                    <Button
                      type="submit"
                      variant="danger-solid"
                      disabled={!ready}
                      aria-describedby={ready ? undefined : 'withdraw-hint'}
                    >
                      탈퇴하기
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
