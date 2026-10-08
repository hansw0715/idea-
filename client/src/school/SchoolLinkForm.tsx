/**
 * 학교 계정 연동 폼 — 가입 3단계(Signup)와 연동 시트(SchoolLinkSheet)가 함께 쓴다.
 * KRDS "동의" + "개인 식별 정보 입력" 패턴: 수집 목적·보관 방식·한계를 평문으로 먼저 안내하고,
 * 동의에 체크해야 연동 버튼이 켜진다.
 *
 * 학번·비밀번호는 React 상태에 두지 않는다. 입력칸은 제어하지 않는 입력(uncontrolled)이라 값은 화면의 입력칸에만 있고,
 * 제출하는 순간 FormData 에서 읽어 school.link 로 넘긴 뒤 곧바로 입력칸을 비운다.
 * 오류가 나면 비밀번호 칸을 비운다 (틀린 비밀번호를 그대로 다시 보내 학교 쪽 실패 횟수를 늘리지 않게).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import { SCHOOL_PASSWORD_WARNING, isStudentId } from '../../../shared/school/types';
import type { SchoolProfile } from '../../../shared/school/types';
import { Alert, Button, Choice, PasswordField, TextField } from '../ui';
import { classifySchoolError } from './errors';
import { verifiedLine } from './format';
import { SchoolErrorAlert, SchoolWaiting } from './SchoolParts';
import { useSchool } from './SchoolContext';

export const LINK_FORM_ID = 'school-link-form';
export const LINK_ID_FIELD = 'school-link-id';
const PASSWORD_FIELD = 'school-link-pw';
const CONSENT_FIELD = 'school-link-consent';
const REASON_ID = 'school-link-reason';
/** 입력칸 name. 비밀번호 칸을 school-pw 로 두어 우리 서비스 비밀번호로 자동완성되지 않게 한다 */
const NAME_ID = 'school-id';
const NAME_PW = 'school-pw';

/** 학교 비밀번호 길이 한도 (서버 검사와 같다). maxLength 속성을 쓰면 긴 비밀번호가 조용히 잘려 틀린 채 전송되므로 직접 검사한다 */
const MAX_PASSWORD = 64;

interface FieldErrors {
  studentId?: string;
  password?: string;
}

export interface LinkFormController {
  formId: string;
  consent: boolean;
  setConsent: (value: boolean) => void;
  busy: boolean;
  /** 서버·금고가 알려 준 실패. 비밀번호 칸은 이미 비워 둔 상태다 */
  failure: { error: unknown } | null;
  fieldErrors: FieldErrors;
  submit: (e: FormEvent<HTMLFormElement>) => void;
  alertRef: RefObject<HTMLDivElement | null>;
}

interface Options {
  /** 가입 직후처럼 앱 전체가 아직 로그인 상태가 아닐 때, 방금 가입한 사용자 */
  forUser?: { id: number; username: string };
  onLinked: (profile: SchoolProfile) => void;
}

function clearInputs(form: HTMLFormElement, which: 'password' | 'both'): void {
  const pw = form.elements.namedItem(NAME_PW);
  if (pw instanceof HTMLInputElement) pw.value = '';
  if (which === 'both') {
    const id = form.elements.namedItem(NAME_ID);
    if (id instanceof HTMLInputElement) id.value = '';
  }
}

export function useSchoolLinkForm({ forUser, onLinked }: Options): LinkFormController {
  const school = useSchool();
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 오류 알림이 생기면 화면 안으로 가져오고 포커스를 옮겨 스크린 리더가 바로 읽게 한다
  useEffect(() => {
    if (!failure) return;
    alertRef.current?.scrollIntoView({ block: 'nearest' });
    alertRef.current?.focus({ preventScroll: true });
  }, [failure]);

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // 한 번에 하나만: 학교 로그인 요청이 이미 가 있으면 두 번째 제출은 보내지 않는다
      if (inFlight.current || !consent) return;
      const form = e.currentTarget;
      const data = new FormData(form);
      const studentId = String(data.get(NAME_ID) ?? '').trim();
      const password = String(data.get(NAME_PW) ?? '');

      const errors: FieldErrors = {};
      if (!isStudentId(studentId)) {
        errors.studentId = '학번 형식이 맞지 않아요. 학교 포털에 로그인할 때 쓰는 숫자 6~10자리를 입력해 주세요.';
      }
      if (password.length === 0) {
        errors.password = '비밀번호를 입력해 주세요. 학교 포털에 로그인할 때 쓰는 비밀번호예요.';
      } else if (password.length > MAX_PASSWORD) {
        errors.password = `비밀번호가 너무 길어요. 학교 포털 비밀번호는 ${MAX_PASSWORD}자 이하만 확인할 수 있어요.`;
      }
      setFieldErrors(errors);
      if (errors.studentId || errors.password) {
        document.getElementById(errors.studentId ? LINK_ID_FIELD : PASSWORD_FIELD)?.focus();
        return;
      }

      inFlight.current = true;
      setBusy(true);
      setFailure(null);
      try {
        const profile = await school.link({ studentId, password }, forUser);
        clearInputs(form, 'both');
        if (alive.current) onLinked(profile);
      } catch (err) {
        clearInputs(form, 'password');
        if (alive.current) setFailure({ error: err });
      } finally {
        inFlight.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [consent, school, forUser, onLinked],
  );

  return {
    formId: LINK_FORM_ID,
    consent,
    setConsent,
    busy,
    failure,
    fieldErrors,
    submit: (e) => void submit(e),
    alertRef,
  };
}

/** 연동 버튼. 시트에서는 하단 고정 줄에, 가입 3단계에서는 폼 안에 둔다 (form 속성으로 같은 폼을 제출한다) */
export function SchoolLinkSubmit({
  controller,
  size,
  block,
}: {
  controller: LinkFormController;
  size?: 'md' | 'lg';
  block?: boolean;
}) {
  return (
    <Button
      type="submit"
      form={controller.formId}
      size={size}
      block={block}
      disabled={!controller.consent}
      loading={controller.busy}
      aria-describedby={controller.consent ? undefined : REASON_ID}
    >
      {controller.busy ? '학교에 확인하는 중…' : '연동하기'}
    </Button>
  );
}

/** 수집 목적·보관 방식·한계·해제 방법 (평문, 접지 않는다) */
export function SchoolLinkNotice() {
  return (
    <section className="school-notice" aria-labelledby="school-notice-title">
      <h3 className="school-notice__title" id="school-notice-title">
        학교 계정 정보 수집·이용 안내
      </h3>
      <ul className="school-notice__list">
        <li>학교 시간표 가져오기와 시설 신청을 대신 하려고 학교 포털 학번·비밀번호를 한 번 확인해요.</li>
        <li>저장되는 건 암호문뿐이에요. 풀 수 있는 키는 내 아이디·비밀번호로 이 기기에서 만들고, 서버에는 보내지 않아요.</li>
        <li>학교 기능을 쓰는 순간에는 우리 서버가 요청 처리를 위해 잠깐 사용하고 바로 버려요. 저장하거나 기록하지 않아요.</li>
        <li>언제든 연동을 해제할 수 있어요.</li>
        <li>다른 기기에서 로그인해도 같은 키가 만들어져서 연동이 이어져요. 비밀번호를 잊으면 암호를 풀 수 없어 다시 연동해야 해요.</li>
      </ul>
      <p className="school-notice__foot">
        처음 연동할 때는 학교 사이트 화면이 달라서 실패할 수 있어요. 비밀번호가 맞는데도 계속 안 되면 학교 사이트에서 직접
        이용해 주세요.
      </p>
    </section>
  );
}

interface FormProps {
  controller: LinkFormController;
  /** 학교 응답이 너무 오래 걸려 시트를 닫을 수 있게 풀린 상태 (안내 문구만 바뀐다) */
  overdue?: boolean;
  /** 폼 맨 아래에 놓을 버튼 (가입 3단계처럼 버튼이 폼 안에 있을 때) */
  children?: ReactNode;
}

export default function SchoolLinkForm({ controller: c, overdue = false, children }: FormProps) {
  return (
    <form id={c.formId} onSubmit={c.submit} noValidate autoComplete="off" aria-busy={c.busy || undefined}>
      {c.failure && (
        <div className="school-alert" ref={c.alertRef} tabIndex={-1}>
          <SchoolErrorAlert error={c.failure.error} title="학교 계정을 연동하지 못했어요.">
            {classifySchoolError(c.failure.error) === 'auth-failed' && (
              <p>비밀번호 칸은 비워 두었어요. 학교 포털에서 로그인이 되는 것을 확인한 뒤에 다시 입력해 주세요.</p>
            )}
          </SchoolErrorAlert>
        </div>
      )}

      <SchoolLinkNotice />

      <TextField
        id={LINK_ID_FIELD}
        name={NAME_ID}
        label="학번"
        required
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        placeholder="숫자 6~10자리"
        help="학교 포털에 로그인할 때 쓰는 학번이에요."
        error={c.fieldErrors.studentId}
        disabled={c.busy}
      />
      <PasswordField
        id={PASSWORD_FIELD}
        name={NAME_PW}
        label="학교 포털 비밀번호"
        required
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        data-lpignore="true"
        data-1p-ignore="true"
        help={SCHOOL_PASSWORD_WARNING}
        error={c.fieldErrors.password}
        disabled={c.busy}
      />

      <div className="school-consent">
        <Choice
          type="checkbox"
          id={CONSENT_FIELD}
          name="school-consent"
          label="학교 계정 정보 수집·이용에 동의합니다"
          checked={c.consent}
          onChange={(e) => c.setConsent(e.target.checked)}
          aria-required="true"
          disabled={c.busy}
        />
        {!c.consent && (
          <p className="field__help school-consent__reason" id={REASON_ID}>
            동의에 체크하면 연동하기를 누를 수 있어요.
          </p>
        )}
      </div>

      {c.busy && <SchoolWaiting label="학교에 확인하는 중…" overdue={overdue} />}

      {children}
    </form>
  );
}

/** 연동 성공 화면의 본문: 확인된 이름(가림)·학과 + 시간표를 지금 가져올지 묻는 문장. 버튼은 놓는 쪽이 정한다 */
export function SchoolLinkDone({ profile, canImport }: { profile: SchoolProfile; canImport: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // 화면이 바뀐 것을 스크린 리더가 알 수 있게 성공 안내로 포커스를 옮긴다
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="school-done" ref={ref} tabIndex={-1}>
      <Alert tone="success" title="학교 계정을 연동했어요.">
        {verifiedLine(profile.name, profile.department)}
      </Alert>
      {canImport ? (
        <>
          <h3 className="school-done__title">학교 시간표를 지금 가져올까요?</h3>
          <p className="school-done__text">
            가져오기 전에 어떤 수업이 들어오는지 먼저 보여 드려요. 나중에 시간표 화면에서도 가져올 수 있어요.
          </p>
        </>
      ) : (
        <p className="school-done__text">이제 학교 시간표 가져오기와 시설 바로 신청을 쓸 수 있어요.</p>
      )}
    </div>
  );
}
