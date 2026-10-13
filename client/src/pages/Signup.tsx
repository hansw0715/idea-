import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';
import { AppHeader } from '../shell/Shell';
import { normalizeUsername, passwordError, usernameError } from '../../../shared/auth';
import { SCHOOL_PASSWORD_WARNING, isStudentId } from '../../../shared/school/types';
import type { SchoolCredentials, SchoolVerifyResponse } from '../../../shared/school/types';
import { authApi } from '../school/authApi';
import { classifySchoolError } from '../school/errors';
import { maskName, verifiedLine } from '../school/format';
import { cacheKey } from '../school/loginKey';
import { SchoolErrorAlert, SchoolWaiting } from '../school/SchoolParts';
import { vault } from '../school/vault';
import { Alert, Button, Choice, PasswordField, Stepper, TextField, btnClass, useToast } from '../ui';
import './auth.css';

/** 한성대 정보 시스템 → 플랫폼 아이디·비밀번호 → 연동 동의 → 가입 완료 */
const STEPS = ['학교 인증', '계정 만들기', '연동 동의', '가입 완료'];
type Step = 'school' | 'account' | 'consent' | 'done';

const ID = {
  schoolId: 'signup-school-id',
  schoolPw: 'signup-school-pw',
  username: 'signup-username',
  password: 'signup-password',
  confirm: 'signup-confirm',
  consent: 'signup-consent',
  done: 'signup-done-title',
} as const;
/** 학교 입력칸 name. 비밀번호 칸을 school-pw 로 두어 우리 서비스 비밀번호로 자동완성되지 않게 한다 */
const NAME_SCHOOL_ID = 'school-id';
const NAME_SCHOOL_PW = 'school-pw';
const MAX_SCHOOL_PASSWORD = 64;

type FieldKey = 'username' | 'password' | 'confirm';
type FieldErrors = Partial<Record<FieldKey, string>>;
type Availability = { name: string; state: 'checking' | 'ok' | 'taken' | 'error'; reason?: string };

const lead: Record<Step, string> = {
  school: '먼저 한성대 학생인지 학교 계정으로 확인해요.',
  account: '이 서비스에서 쓸 아이디와 비밀번호를 만들어 주세요.',
  consent: '학교 계정을 안전하게 연동하는 방법을 확인하고 동의해 주세요.',
  done: '가입과 학교 연동이 끝났어요.',
};

export default function Signup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>('school');
  const [verified, setVerified] = useState<SchoolVerifyResponse | null>(null);
  /**
   * 학교 인증을 마친 학번·비밀번호. 암호화는 ②에서 정할 플랫폼 비밀번호로 만든 키로 하므로, 가입을 마칠 때까지만
   * 이 기기의 메모리(ref)에 둔다 — React 상태·저장소·URL·콘솔에는 두지 않는다. 가입을 마치거나 처음으로 돌아가면 비운다.
   */
  const credsRef = useRef<SchoolCredentials | null>(null);

  const [schoolError, setSchoolError] = useState<unknown>(null);
  const [verifying, setVerifying] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [availability, setAvailability] = useState<Availability | null>(null);

  const [consent, setConsent] = useState(false);
  const [signingUp, setSigningUp] = useState<null | 'key' | 'send'>(null);
  const [error, setError] = useState<{ title: string; message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 가입은 끝났지만 아직 앱 전체에 로그인 정보(setUser)를 올리지 않은 사용자.
   * setUser 를 부르면 이 화면(로그인한 사람은 홈으로 보내는 Public)이 사라지므로 완료 화면의 버튼을 누를 때까지 미룬다.
   * 서버 쿠키는 가입 때 이미 로그인 상태가 되었다.
   */
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [keySaved, setKeySaved] = useState(true);

  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const checkSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      wipeCreds();
    };
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => {
    if (error || schoolError) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, schoolError]);

  function wipeCreds() {
    const c = credsRef.current;
    if (c) {
      c.studentId = '';
      c.password = '';
    }
    credsRef.current = null;
  }

  function clearSchoolInputs(form: HTMLFormElement, which: 'password' | 'both') {
    const pw = form.elements.namedItem(NAME_SCHOOL_PW);
    if (pw instanceof HTMLInputElement) pw.value = '';
    if (which === 'both') {
      const id = form.elements.namedItem(NAME_SCHOOL_ID);
      if (id instanceof HTMLInputElement) id.value = '';
    }
  }

  // ── ① 학교 인증 ────────────────────────────────────────────
  const [schoolFieldErrors, setSchoolFieldErrors] = useState<{ studentId?: string; password?: string }>({});

  async function verifySchool(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 한 번에 하나만: 학교 로그인 요청이 이미 가 있으면 두 번째 제출은 보내지 않는다
    if (verifying) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const studentId = String(data.get(NAME_SCHOOL_ID) ?? '').trim();
    const schoolPassword = String(data.get(NAME_SCHOOL_PW) ?? '');

    const errors: { studentId?: string; password?: string } = {};
    if (!isStudentId(studentId)) {
      errors.studentId = '학번 형식이 맞지 않아요. 학교 포털에 로그인할 때 쓰는 숫자 6~10자리를 입력해 주세요.';
    }
    if (schoolPassword.length === 0) {
      errors.password = '비밀번호를 입력해 주세요. 학교 포털에 로그인할 때 쓰는 비밀번호예요.';
    } else if (schoolPassword.length > MAX_SCHOOL_PASSWORD) {
      errors.password = `비밀번호가 너무 길어요. 학교 포털 비밀번호는 ${MAX_SCHOOL_PASSWORD}자 이하만 확인할 수 있어요.`;
    }
    setSchoolFieldErrors(errors);
    if (errors.studentId || errors.password) {
      setFocusTarget(errors.studentId ? ID.schoolId : ID.schoolPw);
      return;
    }

    setVerifying(true);
    setSchoolError(null);
    setNotice(null);
    try {
      const result = await authApi.schoolVerify({ studentId, password: schoolPassword });
      wipeCreds();
      credsRef.current = { studentId, password: schoolPassword };
      clearSchoolInputs(form, 'both');
      if (!alive.current) return;
      setVerified(result);
      setStep('account');
      // 단계가 바뀐 뒤 키보드가 바로 올라와 화면을 가리지 않게, 입력 칸 대신 제목으로 포커스를 옮긴다
      setFocusTarget('signup-title');
    } catch (err) {
      // 틀린 비밀번호를 그대로 다시 보내 학교 쪽 실패 횟수를 늘리지 않게 비밀번호 칸을 비운다
      clearSchoolInputs(form, 'password');
      if (alive.current) setSchoolError(err);
    } finally {
      if (alive.current) setVerifying(false);
    }
  }

  // ── ② 플랫폼 아이디·비밀번호 ────────────────────────────────
  function clearFieldError(key: FieldKey) {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  /** 아이디 입력칸을 벗어날 때 쓸 수 있는 아이디인지 서버에 묻는다 (최신 요청만 반영) */
  async function checkAvailability(raw: string) {
    const name = normalizeUsername(raw);
    if (usernameError(name)) {
      setAvailability(null);
      return;
    }
    const seq = ++checkSeq.current;
    setAvailability({ name, state: 'checking' });
    try {
      const r = await authApi.usernameAvailable(name);
      if (!alive.current || seq !== checkSeq.current) return;
      setAvailability({ name, state: r.available ? 'ok' : 'taken', reason: r.reason });
    } catch {
      if (alive.current && seq === checkSeq.current) setAvailability({ name, state: 'error' });
    }
  }

  function submitAccount(e: FormEvent) {
    e.preventDefault();
    const name = normalizeUsername(username);
    const next: FieldErrors = {};
    const uErr = usernameError(name);
    if (uErr) next.username = uErr;
    else if (availability?.name === name && availability.state === 'taken') {
      next.username = availability.reason ?? '이미 쓰고 있는 아이디예요.';
    }
    const pErr = passwordError(password);
    if (pErr) next.password = pErr;
    if (!pErr && confirm !== password) next.confirm = '비밀번호가 서로 달라요. 같은 비밀번호를 한 번 더 입력해 주세요.';
    setFieldErrors(next);
    const first = (['username', 'password', 'confirm'] as const).find((k) => next[k]);
    if (first) {
      setFocusTarget(ID[first]);
      return;
    }
    setError(null);
    setStep('consent');
    setConsent(false);
  }

  function backToSchool() {
    wipeCreds();
    setVerified(null);
    setPassword('');
    setConfirm('');
    setConsent(false);
    setError(null);
    setSchoolError(null);
    setStep('school');
    setFocusTarget('signup-title');
  }

  // ── ③ 연동 동의 → 가입 ──────────────────────────────────────
  async function complete() {
    if (signingUp || !consent || !verified || !credsRef.current) return;
    const name = normalizeUsername(username);
    setError(null);
    setSigningUp('key');
    try {
      // 키는 방금 정한 아이디·비밀번호에서 이 브라우저가 만든다 (서버에는 보내지 않는다)
      const key = await vault.deriveKey(name, password);
      const cipher = await vault.seal(null, name, credsRef.current, key);
      if (alive.current) setSigningUp('send');
      const user = await authApi.signup({ ticket: verified.ticket, username: name, password, cipher });
      const saved = cacheKey(user.id, key);
      key.fill(0);
      wipeCreds();
      if (!alive.current) return;
      setKeySaved(saved);
      setPendingUser({ id: user.id, username: user.username, name: user.name, isAdmin: user.isAdmin, email: user.email });
      // 입력했던 비밀번호는 더 쓰지 않으니 상태에서 비운다
      setPassword('');
      setConfirm('');
      setStep('done');
      setFocusTarget(ID.done);
    } catch (err) {
      if (!alive.current) return;
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'USERNAME_TAKEN') {
        setFieldErrors({ username: err instanceof Error ? err.message : '이미 쓰고 있는 아이디예요.' });
        setAvailability({ name, state: 'taken' });
        setStep('account');
        setFocusTarget(ID.username);
      } else if (code === 'TICKET_INVALID') {
        backToSchool();
        setNotice('학교 인증이 만료됐어요. 처음부터 다시 인증해 주세요.');
      } else {
        setError({
          title: '가입하지 못했어요.',
          message: err instanceof Error ? err.message : '회원가입에 실패했어요. 잠시 후 다시 시도해 주세요.',
          code,
        });
      }
    } finally {
      if (alive.current) setSigningUp(null);
    }
  }

  /** 완료 화면의 버튼: 이제 앱 전체에 로그인 정보를 올리고 화면을 옮긴다 */
  function finish(destination: '/' | '/timetable?school=import') {
    if (!pendingUser) return;
    if (!keySaved) {
      toast('이 브라우저에 보안 키를 저장하지 못했어요. 로그인하면 다시 만들어져요.');
    }
    setUser(pendingUser);
    navigate(destination, { replace: true });
  }

  const currentIndex = step === 'school' ? 1 : step === 'account' ? 2 : step === 'consent' ? 3 : 4;
  const checking = availability?.state === 'checking';
  const usernameHelp = (() => {
    const name = normalizeUsername(username);
    if (availability && availability.name === name) {
      if (availability.state === 'checking') return '쓸 수 있는 아이디인지 확인하는 중…';
      if (availability.state === 'ok') return '쓸 수 있는 아이디예요.';
      if (availability.state === 'error') return '지금은 확인하지 못했어요. 가입할 때 한 번 더 확인해요.';
    }
    return '영문 소문자·숫자·밑줄(_) 4~20자. 로그인할 때 써요.';
  })();

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main">
        <img className="auth-logo auth-logo--sm" src="/brand/logo.png" alt="상상Book-E" width="720" height="559" />
        <div className="page-head">
          <h1 className="page-title" id="signup-title" tabIndex={-1}>
            회원가입
          </h1>
          <p className="page-lead">{lead[step]}</p>
        </div>

        <div className="auth-steps">
          <Stepper steps={STEPS} current={currentIndex} />
        </div>

        {notice && (
          <div className="auth-alert">
            <Alert tone="info">{notice}</Alert>
          </div>
        )}

        {/* ───────── ① 학교 인증 ───────── */}
        {step === 'school' && (
          <form onSubmit={(e) => void verifySchool(e)} noValidate autoComplete="off" aria-busy={verifying || undefined}>
            {schoolError !== null && (
              <div className="auth-alert" ref={alertRef} tabIndex={-1}>
                <SchoolErrorAlert error={schoolError} title="학교 인증에 실패했어요.">
                  {classifySchoolError(schoolError) === 'auth-failed' && (
                    <p>비밀번호 칸은 비워 두었어요. 학교 포털에서 로그인이 되는 것을 확인한 뒤에 다시 입력해 주세요.</p>
                  )}
                  {schoolError instanceof ApiError && schoolError.code === 'SCHOOL_ALREADY_REGISTERED' && (
                    <p>
                      <Link to="/login" className={btnClass({ variant: 'secondary', size: 'sm' })}>
                        로그인하기
                      </Link>
                    </p>
                  )}
                </SchoolErrorAlert>
              </div>
            )}

            <section className="school-notice" aria-labelledby="signup-school-notice">
              <h2 className="school-notice__title" id="signup-school-notice">
                학교 계정으로 학생 인증
              </h2>
              <ul className="school-notice__list">
                <li>한성대 정보 시스템(학교 포털)의 학번·비밀번호로 한성대 학생인지 확인해요.</li>
                <li>여기서 입력한 학교 비밀번호는 확인에만 쓰고 서버에 저장하지 않아요. 암호화하는 방법은 마지막 단계에서 알려 드려요.</li>
              </ul>
            </section>

            <TextField
              id={ID.schoolId}
              name={NAME_SCHOOL_ID}
              label="학번"
              required
              size="lg"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="숫자 6~10자리"
              help="학교 포털에 로그인할 때 쓰는 학번이에요."
              error={schoolFieldErrors.studentId}
              disabled={verifying}
            />
            <PasswordField
              id={ID.schoolPw}
              name={NAME_SCHOOL_PW}
              label="학교 포털 비밀번호"
              required
              size="lg"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              data-lpignore="true"
              data-1p-ignore="true"
              help={SCHOOL_PASSWORD_WARNING}
              error={schoolFieldErrors.password}
              disabled={verifying}
            />

            {verifying && <SchoolWaiting label="학교에 확인하는 중…" />}

            <Button type="submit" size="lg" block loading={verifying}>
              {verifying ? '학교에 확인하는 중…' : '학생 인증하기'}
            </Button>
          </form>
        )}

        {/* ───────── ② 플랫폼 아이디·비밀번호 ───────── */}
        {step === 'account' && verified && (
          <form onSubmit={submitAccount} noValidate>
            <div className="auth-alert">
              <Alert tone="success" title="학교 인증이 끝났어요.">
                {verifiedLine(verified.profile.name, verified.profile.department)}
              </Alert>
            </div>

            <TextField
              id={ID.username}
              name="username"
              label="아이디"
              required
              size="lg"
              type="text"
              placeholder="영문 소문자·숫자·밑줄"
              help={usernameHelp}
              error={fieldErrors.username}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.replace(/\s/g, '').toLowerCase());
                clearFieldError('username');
                setAvailability(null);
              }}
              onBlur={() => void checkAvailability(username)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
            />
            <PasswordField
              id={ID.password}
              name="new-password"
              label="비밀번호"
              required
              size="lg"
              placeholder="8자 이상"
              help="이 비밀번호로 로그인하고, 학교 계정을 풀 열쇠도 만들어요. 잊으면 학교 계정을 다시 연동해야 해요."
              error={fieldErrors.password}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError('password');
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
              placeholder="비밀번호를 한 번 더"
              error={fieldErrors.confirm}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                clearFieldError('confirm');
              }}
              autoComplete="new-password"
              enterKeyHint="go"
            />

            <Button type="submit" size="lg" block disabled={checking}>
              다음
            </Button>
            <Button variant="tertiary" block onClick={backToSchool}>
              학교 인증부터 다시 하기
            </Button>
          </form>
        )}

        {/* ───────── ③ 연동 동의 ───────── */}
        {step === 'consent' && verified && (
          <div>
            {error && (
              <div className="auth-alert" ref={alertRef}>
                <Alert tone="danger" title={error.title}>
                  {error.message}
                </Alert>
              </div>
            )}

            <div className="card signup-summary">
              <dl>
                <div className="kv">
                  <dt className="kv__key">아이디</dt>
                  <dd className="kv__val bold">{normalizeUsername(username)}</dd>
                </div>
                <div className="kv">
                  <dt className="kv__key">이름</dt>
                  <dd className="kv__val">{maskName(verified.profile.name) || '확인했어요'}</dd>
                </div>
                <div className="kv">
                  <dt className="kv__key">학번</dt>
                  <dd className="kv__val">{verified.hint}</dd>
                </div>
                {verified.profile.department && (
                  <div className="kv">
                    <dt className="kv__key">소속</dt>
                    <dd className="kv__val">{verified.profile.department}</dd>
                  </div>
                )}
              </dl>
            </div>

            <section className="school-notice" aria-labelledby="signup-consent-notice">
              <h2 className="school-notice__title" id="signup-consent-notice">
                학교 계정 정보 수집·이용 안내
              </h2>
              <ul className="school-notice__list">
                <li>학교 시간표 가져오기와 시설 신청을 대신 하려고 학교 포털 학번·비밀번호를 암호화해서 보관해요.</li>
                <li>
                  암호를 푸는 열쇠는 방금 정한 아이디·비밀번호로 이 기기에서 만들고, 서버에는 보내지 않아요. 서버에 저장되는 건
                  암호문뿐이에요.
                </li>
                <li>라운지에서는 다른 학우에게 이 학교 계정에서 가져온 이름(가림, 예: 박○재)·학과·학번만 보여요. 실명 전체와 연락처는 보이지 않아요.</li>
                <li>다른 기기에서 같은 아이디·비밀번호로 로그인하면 같은 열쇠가 만들어져서 연동이 이어져요.</li>
                <li>학교 기능을 쓰는 순간에는 우리 서버가 요청 처리를 위해 잠깐 사용하고 바로 버려요. 저장하거나 기록하지 않아요.</li>
                <li>비밀번호를 잊으면 암호를 풀 수 없어 학교 계정을 다시 연동해야 해요. 연동은 언제든 해제할 수 있어요.</li>
              </ul>
            </section>

            <div className="school-consent">
              <Choice
                type="checkbox"
                id={ID.consent}
                name="school-consent"
                label="학교 계정 정보를 암호화해 보관하고 연동하는 것에 동의합니다"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-required="true"
                disabled={signingUp !== null}
              />
              {!consent && (
                <p className="field__help school-consent__reason" id="signup-consent-reason">
                  동의에 체크하면 가입을 완료할 수 있어요.
                </p>
              )}
            </div>

            {signingUp && <SchoolWaiting label={signingUp === 'key' ? '보안 열쇠를 만드는 중…' : '가입하는 중…'} />}

            <Button
              size="lg"
              block
              disabled={!consent}
              loading={signingUp !== null}
              aria-describedby={consent ? undefined : 'signup-consent-reason'}
              onClick={() => void complete()}
            >
              {signingUp === 'key' ? '열쇠를 만드는 중…' : signingUp === 'send' ? '가입하는 중…' : '가입 완료'}
            </Button>
            <Button variant="tertiary" block disabled={signingUp !== null} onClick={() => setStep('account')}>
              이전
            </Button>
          </div>
        )}

        {/* ───────── ④ 가입 완료 ───────── */}
        {step === 'done' && pendingUser && (
          <div>
            <h2 className="school-step__title" id={ID.done} tabIndex={-1}>
              환영해요, {pendingUser.name ? `${maskName(pendingUser.name)}님` : '한성대 학우님'}
            </h2>
            <Alert tone="success" title="가입과 학교 연동이 끝났어요.">
              이제 학교 시간표 가져오기와 시설 바로 신청을 쓸 수 있어요.
            </Alert>
            <h3 className="school-done__title">학교 시간표를 지금 가져올까요?</h3>
            <p className="school-done__text">
              가져오기 전에 어떤 수업이 들어오는지 먼저 보여 드려요. 나중에 시간표 화면에서도 가져올 수 있어요.
            </p>
            <div className="school-step__actions">
              <Button size="lg" block onClick={() => finish('/timetable?school=import')}>
                지금 가져오기
              </Button>
              <Button variant="tertiary" block onClick={() => finish('/')}>
                나중에
              </Button>
            </div>
          </div>
        )}

        {step !== 'done' && (
          <div className="auth-foot">
            <span>이미 계정이 있나요?</span>
            <Link to="/login" className={btnClass({ variant: 'text' })}>
              로그인
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
