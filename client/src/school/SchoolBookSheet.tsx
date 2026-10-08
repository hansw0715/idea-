/**
 * 학교 바로 신청 — 가장 조심스러운 흐름.
 *  ① 미리보기(학교에는 로그인해 신청서를 읽기만 한다) → ② 신청서 입력 → ③ 요약 확인 + 동의 → 제출 → ④ 결과
 *
 * 지키는 약속
 *  - 제출은 사용자가 "학교에 신청하기"를 누른 그 한 번뿐이다. 누르는 순간 버튼이 잠기고, 결과가 나올 때까지 시트를 닫지 않는다.
 *  - 어떤 경우에도 자동으로 다시 보내지 않는다. 결과가 모호하면(unknown / 연결 끊김 / 서버 5xx) 다시 보내기 버튼 없이
 *    "학교 사이트에서 확인해 주세요"로 안내한다.
 *  - 서버가 제출 전에 멈춘 오류(SCHOOL_REJECTED 등)는 학교가 준 문장을 그대로 보여 주고 입력은 보존한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BookPreview, BookResult } from '../../../shared/school/types';
import type { Reservation } from '../types';
import { fmtDate, fmtRange } from '../time';
import { Alert, Badge, Button, Choice, Icon, Sheet, TextField, btnClass } from '../ui';
import { schoolApi } from './api';
import { isAmbiguousSend } from './errors';
import { statusTone } from './format';
import { SchoolErrorAlert, SchoolFoot, SchoolWaiting, useCloseGuard, useOpenSession } from './SchoolParts';
import { useSchool } from './SchoolContext';

export interface SchoolBookSheetProps {
  open: boolean;
  onClose: () => void;
  /** 신청할 우리 앱의 예약 계획. 시트가 열릴 때의 값을 쓴다 */
  reservation: Reservation | null;
  /** 신청을 학교에 보낸 뒤(확인됨/확인 못 함 모두) 불린다 — 예약 목록을 다시 불러오는 데 쓴다 */
  onResult?: (result: BookResult) => void;
  /** "다시 연동하기" — 저장된 계정 정보로 진행할 수 없을 때 */
  onRelink?: () => void;
}

type Stage =
  | { name: 'loading' }
  | { name: 'error'; error: unknown }
  | { name: 'blocked'; preview: BookPreview }
  | { name: 'form'; preview: BookPreview }
  | { name: 'result'; result: BookResult }
  | { name: 'uncertain' };

const TEL_RE = /^[0-9+\-() ]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const FIELD = 'school-book';

/** 서버가 신청 결과를 받지 못했을 때 화면이 대신 알려 주는 결과 (자동 재전송 없음) */
const UNCERTAIN: BookResult = {
  status: 'unknown',
  message: '신청이 학교에 갔는지 확인하지 못했어요. 자동으로 다시 보내지 않아요. 학교 사이트에서 내 신청내역을 확인해 주세요.',
  found: [],
};

export default function SchoolBookSheet(props: SchoolBookSheetProps) {
  const session = useOpenSession(props.open);
  return <BookSheetBody key={session} {...props} />;
}

function BookSheetBody({ open, onClose, reservation, onResult, onRelink }: SchoolBookSheetProps) {
  const { withCredentials } = useSchool();
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const [tel, setTel] = useState('');
  const [email, setEmail] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState(false);

  const started = useRef(false);
  const submitted = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const reservationId = reservation?.id ?? null;

  const loadPreview = useCallback(async () => {
    if (reservationId === null) return;
    setStage({ name: 'loading' });
    try {
      const preview = await withCredentials((creds) => schoolApi.bookPreview(creds, reservationId));
      if (!preview.canBook) {
        setStage({ name: 'blocked', preview });
        return;
      }
      setTel(preview.applicant.tel);
      setEmail(preview.applicant.email);
      setValues({});
      setTouched({});
      setConsent(false);
      setStage({ name: 'form', preview });
    } catch (err) {
      setStage({ name: 'error', error: err });
    }
  }, [withCredentials, reservationId]);

  // 열리자마자 한 번만 미리보기를 읽는다 (다시 그리기·StrictMode 로 두 번 부르지 않는다)
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void loadPreview();
  }, [open, loadPreview]);

  const busy = stage.name === 'loading' || submitting;
  const { close, overdue } = useCloseGuard(busy, onClose);

  useEffect(() => {
    if (submitError) {
      alertRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [submitError]);

  // 결과(확인됨·확인 못 함·연결 끊김)가 나오면 눌렀던 신청 버튼이 사라지므로, 포커스를 결과 안내로 옮겨 스크린 리더가 읽게 한다
  const showingResult = stage.name === 'result' || stage.name === 'uncertain';
  useEffect(() => {
    if (showingResult) resultRef.current?.focus({ preventScroll: true });
  }, [showingResult]);

  // ── 입력 검사 ─────────────────────────────────────────────
  const preview = stage.name === 'form' ? stage.preview : null;
  const missing = useMemo(
    () => (preview ? preview.items.filter((it) => it.required && !(values[it.name] ?? '').trim()).map((it) => it.name) : []),
    [preview, values],
  );
  const telError = tel.length > 30 || !TEL_RE.test(tel) ? '연락처는 숫자와 -, +, 괄호만 30자 이하로 입력해 주세요.' : null;
  const emailError = email.length > 100 || (email !== '' && !EMAIL_RE.test(email)) ? '이메일 형식을 확인해 주세요. 예: name@hansung.ac.kr' : null;
  const canSubmit = Boolean(preview) && consent && missing.length === 0 && !telError && !emailError && !submitting;

  // 단추를 못 누르는 이유를 단추 가까이에 글자로 말한다
  const reason =
    missing.length > 0
      ? `필수 항목을 입력해 주세요: ${missing.join(', ')}`
      : telError || emailError
        ? '연락처와 이메일을 확인해 주세요.'
        : !consent
          ? '신청 내용에 동의하면 학교에 신청할 수 있어요.'
          : null;

  async function submit() {
    // 한 번 누르면 끝: 결과가 나오기 전에는 어떤 경로로도 두 번째 요청을 만들지 않는다
    if (!preview || !canSubmit || submitted.current || reservationId === null) return;
    submitted.current = true;
    setSubmitting(true);
    setSubmitError(null);
    // 제출 요청을 실제로 내보냈는지 구분한다: 그 앞 단계(암호문 받기·풀기)에서 난 오류는 학교에 아무것도 가지 않았다
    let dispatched = false;
    try {
      const result = await withCredentials((creds) => {
        dispatched = true;
        return schoolApi.bookSubmit({
          creds,
          reservationId,
          items: Object.fromEntries(preview.items.map((it) => [it.name, (values[it.name] ?? '').trim()])),
          tel: tel.trim(),
          email: email.trim(),
        });
      });
      setStage({ name: 'result', result });
      onResult?.(result);
    } catch (err) {
      if (dispatched && isAmbiguousSend(err)) {
        // 신청이 학교에 갔을 수 있다. 같은 신청을 다시 보내지 않고 확인하도록 안내한다
        setStage({ name: 'uncertain' });
        onResult?.(UNCERTAIN);
      } else {
        // 서버가 제출 전에 멈춘 오류: 입력을 그대로 두고 문장을 보여 준다. 고친 뒤 직접 다시 누를 수 있다
        submitted.current = false;
        setSubmitError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const reserveUrl = reservation?.reserveUrl ?? null;
  const schoolLink = reserveUrl ? (
    <a className={btnClass({ variant: 'secondary', size: 'sm' })} href={reserveUrl} target="_blank" rel="noreferrer">
      학교 예약 사이트 열기
      <Icon name="external" className="btn__icon" />
      <span className="sr-only">(새 창으로 열림)</span>
    </a>
  ) : null;

  // ── 하단 버튼 ─────────────────────────────────────────────
  let footer;
  if (stage.name === 'form') {
    footer = (
      <SchoolFoot>
        <Button
          onClick={() => void submit()}
          disabled={!canSubmit && !submitting}
          loading={submitting}
          aria-describedby={reason ? `${FIELD}-reason` : undefined}
        >
          {submitting ? '신청 중…' : '학교에 신청하기'}
        </Button>
        <Button variant="tertiary" onClick={close} disabled={submitting && !overdue}>
          취소
        </Button>
      </SchoolFoot>
    );
  } else if (stage.name === 'result' || stage.name === 'uncertain') {
    footer = (
      <SchoolFoot>
        <Button onClick={onClose}>닫기</Button>
      </SchoolFoot>
    );
  } else {
    footer = (
      <SchoolFoot>
        <Button variant="tertiary" onClick={close} disabled={busy && !overdue}>
          닫기
        </Button>
      </SchoolFoot>
    );
  }

  return (
    <Sheet open={open} onClose={close} title="학교에 바로 신청하기" footer={footer}>
      {reservation && (
        <p className="school-book__lead">
          신청할 예약 · {reservation.facilityName} · {fmtDate(reservation.date)} {fmtRange(reservation.startMin, reservation.endMin)}
        </p>
      )}

      {stage.name === 'loading' && <SchoolWaiting label="학교에 신청할 수 있는지 확인하는 중…" overdue={overdue} />}

      {stage.name === 'error' && (
        <SchoolErrorAlert
          error={stage.error}
          title="신청 정보를 불러오지 못했어요."
          onRelink={onRelink}
          onRetry={() => void loadPreview()}
        />
      )}

      {stage.name === 'blocked' && (
        <>
          <Alert
            tone={stage.preview.alreadySubmitted ? 'info' : 'warning'}
            title={stage.preview.alreadySubmitted ? '이미 신청을 보냈어요' : '지금은 학교에 신청할 수 없어요'}
          >
            <p>
              {stage.preview.alreadySubmitted
                ? "이미 신청을 보냈어요. 학교 사이트에서 확인하고 '학교 예약 확인'을 눌러 주세요."
                : (stage.preview.reason ?? '이 예약은 지금 학교에 신청할 수 없어요.')}
            </p>
          </Alert>
          {/* 학교에 바로 신청할 수 없는 예약에 사이트 링크를 주지 않는다 — 신청은 연동으로만 한다. 이미 보낸 신청은 확인용으로 둔다. */}
          {stage.preview.alreadySubmitted && schoolLink && <div className="school-book__link">{schoolLink}</div>}
        </>
      )}

      {stage.name === 'form' && (
        <>
          {submitError !== null && (
            <div className="school-alert" ref={alertRef}>
              <SchoolErrorAlert error={submitError} title="학교에 신청하지 못했어요." onRelink={onRelink}>
                <p>학교에는 신청이 가지 않았어요. 입력한 내용은 그대로 두었으니, 확인한 뒤 다시 눌러 주세요.</p>
              </SchoolErrorAlert>
            </div>
          )}

          <section className="school-book__section" aria-labelledby={`${FIELD}-what`}>
            <h3 className="school-book__heading" id={`${FIELD}-what`}>
              신청 내용
            </h3>
            <dl className="school-info">
              <Row label="시설" value={stage.preview.title} />
              <Row label="일시" value={stage.preview.when} />
              <Row label="신청 대상" value={stage.preview.identities.length > 0 ? stage.preview.identities.join(', ') : '제한 없음'} />
              {stage.preview.manager && <Row label="학교 담당" value={stage.preview.manager} />}
            </dl>
          </section>

          <section className="school-book__section" aria-labelledby={`${FIELD}-who`}>
            <h3 className="school-book__heading" id={`${FIELD}-who`}>
              신청자
            </h3>
            <dl className="school-info">
              <Row label="이름" value={stage.preview.applicant.name || '확인하지 못했어요'} />
              <Row label="학번" value={stage.preview.applicant.studentId || '확인하지 못했어요'} />
            </dl>
            <div className="school-book__fields">
              <TextField
                id={`${FIELD}-tel`}
                label="연락처"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                error={telError}
                help="학교 담당자가 연락할 번호예요. 고쳐서 신청할 수 있어요."
                disabled={submitting}
              />
              <TextField
                id={`${FIELD}-email`}
                label="이메일"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailError}
                disabled={submitting}
              />
            </div>
          </section>

          {stage.preview.items.length > 0 && (
            <section className="school-book__section" aria-labelledby={`${FIELD}-more`}>
              <h3 className="school-book__heading" id={`${FIELD}-more`}>
                추가 항목
              </h3>
              <p className="school-book__lead">학교 신청서에 있는 항목이에요. * 표시는 꼭 입력해야 해요.</p>
              {stage.preview.items.map((it, i) => {
                const empty = !(values[it.name] ?? '').trim();
                return (
                  <TextField
                    key={it.name}
                    id={`${FIELD}-item-${i}`}
                    label={it.name}
                    required={it.required}
                    type="text"
                    maxLength={200}
                    autoComplete="off"
                    value={values[it.name] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [it.name]: e.target.value }))}
                    onBlur={() => setTouched((prev) => ({ ...prev, [it.name]: true }))}
                    error={it.required && empty && touched[it.name] ? `${it.name} 항목은 꼭 입력해야 해요. 신청서에 들어가는 내용을 적어 주세요.` : null}
                    disabled={submitting}
                  />
                );
              })}
            </section>
          )}

          <section className="school-book__section" aria-labelledby={`${FIELD}-confirm`}>
            <h3 className="school-book__heading" id={`${FIELD}-confirm`}>
              보내기 전에 확인해 주세요
            </h3>
            <div className="school-book__confirm">
              <p className="school-book__confirm-title">{stage.preview.title}</p>
              <p>{stage.preview.when}</p>
              <p>
                {stage.preview.applicant.name || '내'}
                {stage.preview.applicant.studentId ? `(${stage.preview.applicant.studentId})` : ''} 이름으로 학교 예약 시스템에
                접수돼요.
              </p>
              <p className="school-book__confirm-note">
                한 번 보낸 신청은 우리 앱에서 취소하거나 다시 보낼 수 없어요. 바꾸거나 취소하려면 학교 사이트에서 직접 해 주세요.
              </p>
            </div>
            <Choice
              type="checkbox"
              id={`${FIELD}-consent`}
              label="위 내용으로 학교에 신청하는 것에 동의해요"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-required="true"
              disabled={submitting}
            />
            {reason && (
              <p className="field__help school-consent__reason" id={`${FIELD}-reason`}>
                {reason}
              </p>
            )}
          </section>

          {submitting && <SchoolWaiting label="학교에 신청하는 중…" overdue={overdue} />}
        </>
      )}

      {stage.name === 'result' && (
        <div ref={resultRef} tabIndex={-1}>
          <ResultView result={stage.result} link={schoolLink} />
        </div>
      )}

      {stage.name === 'uncertain' && (
        <div ref={resultRef} tabIndex={-1}>
          <Alert tone="warning" title="신청이 학교에 갔는지 확인하지 못했어요">
            <p>
              서버와 연결이 끊겼거나 서버에 문제가 생겨 결과를 받지 못했어요. 신청이 이미 접수됐을 수 있어서 자동으로 다시 보내지 않아요. 학교 사이트의 내
              신청내역을 확인해 주세요.
            </p>
            <p>확인한 뒤 이 화면을 다시 열면, 보낸 기록이 있는지 알려 드려요.</p>
          </Alert>
          {schoolLink && <div className="school-book__link">{schoolLink}</div>}
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="school-info__row">
      <dt className="school-info__key">{label}</dt>
      <dd className="school-info__val">{value}</dd>
    </div>
  );
}

function ResultView({ result, link }: { result: BookResult; link: ReactNode }) {
  if (result.status === 'confirmed') {
    return (
      <Alert tone="success" title="학교 신청내역에서 확인했어요">
        <p>신청이 학교 예약 시스템에 접수된 것을 확인했어요. 우리 앱의 예약도 학교 확인됨으로 바뀌어요.</p>
        {result.found.length > 0 && (
          <ul className="school-book__found">
            {result.found.map((f, i) => (
              <li key={`${f.no}-${i}`}>
                {[f.space, f.date, f.time].filter(Boolean).join(' ')}{' '}
                {f.status && <Badge tone={statusTone(f.status)}>{f.status}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Alert>
    );
  }
  // 학교가 신청 직후 알려 준 안내 문장이 있으면 그것도 함께 보여 준다 (서버가 "학교 안내:" 뒤에 붙인다)
  const schoolNote = result.message.includes('학교 안내:') ? result.message.slice(result.message.indexOf('학교 안내:')) : null;
  return (
    <>
      <Alert tone="warning" title="신청을 보냈지만 확인하지 못했어요">
        <p>자동으로 다시 보내지 않아요. 학교 사이트에서 내 신청내역을 확인해 주세요.</p>
        {schoolNote && <p>{schoolNote}</p>}
      </Alert>
      {link && <div className="school-book__link">{link}</div>}
    </>
  );
}
