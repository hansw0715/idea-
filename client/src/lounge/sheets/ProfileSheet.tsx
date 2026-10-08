import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  ADMISSION_YEAR_MIN,
  AVATARS,
  AVATAR_COLORS,
  COLLEGES,
  NICKNAME_MAX,
  NICKNAME_MIN,
  admissionLabel,
  defaultNickname,
  guessAdmissionYear,
  todayKst,
} from '../../../../shared/lounge';
import type { AvatarColor, AvatarKey, Profile } from '../../../../shared/lounge';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useSchool } from '../../school/SchoolContext';
import { Alert, Button, Icon, SelectField, Sheet, TextField, useToast } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar from '../parts/Avatar';
import '../gathering.css';

/**
 * 라운지 프로필 만들기·고치기 시트 — 닉네임, 단과대, 학과, 학번(입학년도), 아바타(얼굴+색).
 * 담당: 작업 C2.
 * 열고 닫는 상태는 LoungeProvider(useLounge)가 들고 있고, 저장하면 loungeApi.saveProfile → setProfile.
 */
export default function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useLounge();
  const school = useSchool();
  const formId = useId();
  const [busy, setBusy] = useState(false);

  // 열릴 때 한 번 정한다: 만드는 중인지(프로필 없음), 시작 값은 무엇인지.
  // 저장하면 profile 이 바로 생겨서, 닫히는 400ms 동안 제목이 "만들기 → 고치기" 로 바뀌지 않게 열린 순간의 값을 쥐고 있는다.
  const prevOpen = useRef(false);
  const session = useRef(0);
  const opened = useRef<{ profile: Profile | null }>({ profile });
  if (open && !prevOpen.current) {
    session.current += 1;
    opened.current = { profile };
  }
  prevOpen.current = open;
  const startProfile = opened.current.profile;
  const creating = startProfile === null;

  // 학교 연동에서 읽은 학과·입학년도. 연동 상태가 이 시트 바깥(SchoolProvider)에 있어 컨텍스트 값이 비어 있을 수 있으니,
  // 만드는 중에는 한 번 직접 물어본다 (비밀이 아닌 힌트만 오는 GET /school/link).
  const [fetchedHint, setFetchedHint] = useState<SchoolHint | null>(null);
  useEffect(() => {
    if (!open || !creating || school.profileHint || fetchedHint) return;
    let cancelled = false;
    api
      .get<{ profileHint?: SchoolHint | null }>('/school/link')
      .then((r) => {
        if (!cancelled && r.profileHint) setFetchedHint(r.profileHint);
      })
      .catch(() => {
        /* 힌트는 편의일 뿐이라 못 받아도 직접 입력하면 된다 */
      });
    return () => {
      cancelled = true;
    };
  }, [open, creating, school.profileHint, fetchedHint]);

  const hint = school.profileHint ?? fetchedHint;

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={creating ? '프로필 만들기' : '프로필 고치기'}
      initialFocus="input"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {creating ? '나중에 하기' : '취소'}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {busy ? '저장하는 중…' : creating ? '프로필 만들기' : '저장하기'}
          </Button>
        </>
      }
    >
      <ProfileForm
        key={session.current}
        formId={formId}
        initial={startProfile}
        hint={hint}
        onBusy={setBusy}
        onDone={onClose}
      />
    </Sheet>
  );
}

type SchoolHint = { department: string; admissionYear: number | null };
type Field = 'nickname' | 'college' | 'department' | 'admissionYear' | 'avatar';
type Errors = Partial<Record<Field, string>>;
const FIELD_ORDER: Field[] = ['nickname', 'college', 'department', 'admissionYear', 'avatar'];

/** 아바타 색 이름 — 색만으로 고르지 않도록 화면 낭독기에는 이름으로 읽힌다 */
const COLOR_NAME: Record<AvatarColor, string> = {
  m1: '남색',
  m2: '초록색',
  m3: '주황색',
  m4: '붉은색',
  m5: '파란색',
  m6: '보라색',
  m7: '청록색',
  m8: '회색',
};

const codePoints = (s: string) => [...s].length;
const currentYear = () => Number(todayKst().slice(0, 4));
/** 입학년도로 쓸 수 있는 값이면 그대로, 아니면 null (학교 힌트는 학번 앞자리 추정이라 범위 밖일 수 있다) */
const validYear = (y: number | null | undefined): number | null =>
  typeof y === 'number' && Number.isInteger(y) && y >= ADMISSION_YEAR_MIN && y <= currentYear() ? y : null;

/** 서버 오류 문장에서 어느 입력칸 이야기인지 짐작 */
function fieldOfServerMessage(message: string): Field | null {
  if (message.includes('닉네임')) return 'nickname';
  if (message.includes('단과대')) return 'college';
  if (message.includes('학과')) return 'department';
  if (message.includes('입학년도')) return 'admissionYear';
  if (message.includes('아바타')) return 'avatar';
  return null;
}

function ProfileForm({
  formId,
  initial,
  hint,
  onBusy,
  onDone,
}: {
  formId: string;
  initial: Profile | null;
  hint: SchoolHint | null;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const { setProfile } = useLounge();
  const toast = useToast();
  const uid = useId();
  const fid = (f: Field) => `${uid}-${f}`;

  // 기본값: 고치는 중이면 현재 프로필, 처음이면 학교 연동 힌트 → 이메일 학번에서 추정 → 비움. 닉네임은 실명을 가려서.
  const guessed = validYear(guessAdmissionYear((user?.email ?? '').split('@')[0]));
  const seed = Number(user?.id ?? 0);
  const [nickname, setNickname] = useState(() =>
    initial ? initial.nickname : [...defaultNickname(user?.name ?? '')].slice(0, NICKNAME_MAX).join(''),
  );
  const [college, setCollege] = useState(initial?.college ?? '');
  const [department, setDepartment] = useState(initial?.department ?? hint?.department ?? '');
  const [year, setYear] = useState<string>(() => {
    const y = initial?.admissionYear ?? validYear(hint?.admissionYear) ?? guessed;
    return y ? String(y) : '';
  });
  const [avatar, setAvatar] = useState<AvatarKey>(initial?.avatar ?? AVATARS[seed % AVATARS.length].key);
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(
    initial?.avatarColor ?? AVATAR_COLORS[seed % AVATAR_COLORS.length],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const touched = useRef({ department: false, year: false });

  // 학교 힌트가 늦게 도착하면, 사용자가 아직 건드리지 않은 칸만 채운다
  useEffect(() => {
    if (initial || !hint) return;
    if (!touched.current.department && hint.department) setDepartment(hint.department);
    const y = validYear(hint.admissionYear);
    if (!touched.current.year && y) setYear(String(y));
  }, [hint, initial]);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const clear = (f: Field) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  function validate(): Errors {
    const e: Errors = {};
    const n = nickname.trim();
    const len = codePoints(n);
    if (len < NICKNAME_MIN || len > NICKNAME_MAX) e.nickname = `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 적어 주세요. 지금은 ${len}자예요.`;
    else if (/[@＠]/u.test(n)) e.nickname = '닉네임에는 @를 쓸 수 없어요. 다른 글자로 바꿔 주세요.';
    else if (/\s{2,}/u.test(n)) e.nickname = '닉네임에는 공백을 연속해서 쓸 수 없어요.';
    if (!college) e.college = '단과대를 골라 주세요.';
    const d = department.trim();
    if (codePoints(d) < 1) e.department = '학과가 비어 있어요. 학과를 적어 주세요. 예) 컴퓨터공학부';
    else if (codePoints(d) > 30) e.department = '학과는 30자까지 쓸 수 있어요.';
    if (!year) e.admissionYear = '입학년도를 골라 주세요.';
    return e;
  }

  function focusField(f: Field) {
    window.setTimeout(() => {
      const el = document.getElementById(fid(f));
      el?.focus();
      el?.scrollIntoView({ block: 'center' });
    }, 30);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (busyRef.current) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      focusField(first);
      return;
    }
    busyRef.current = true;
    onBusy(true);
    try {
      const saved = await loungeApi.saveProfile({
        nickname: nickname.trim(),
        college,
        department: department.trim(),
        admissionYear: Number(year),
        avatar,
        avatarColor,
      });
      // 서버가 정리해서(공백·정규화) 돌려준 값을 그대로 쓴다
      setProfile(saved);
      toast('프로필을 저장했어요.');
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
      const field = fieldOfServerMessage(message);
      if (field) {
        setErrors({ [field]: message });
        focusField(field);
      } else {
        setFormError(message);
      }
    } finally {
      busyRef.current = false;
      onBusy(false);
    }
  }

  const years: number[] = [];
  for (let y = currentYear(); y >= ADMISSION_YEAR_MIN; y -= 1) years.push(y);
  const nickLen = codePoints(nickname.trim());

  const faceItems = AVATARS.map((a) => ({
    value: a.key,
    label: a.label,
    node: <Avatar user={{ avatar: a.key, avatarColor }} size="md" />,
  }));
  const colorItems = AVATAR_COLORS.map((c) => ({
    value: c,
    label: COLOR_NAME[c],
    node: (
      <span className="lounge-gath-swatch" style={{ '--swatch': `var(--m-${c.replace('m', '')})` } as CSSProperties} />
    ),
  }));

  return (
    <form id={formId} noValidate onSubmit={submit} className="lounge-gath-form">
      {formError && (
        <div ref={alertRef} tabIndex={-1} className="lounge-gath-gap">
          <Alert tone="danger" title="프로필을 저장하지 못했어요.">
            {formError}
          </Alert>
        </div>
      )}

      <div className="lounge-gath-gap">
        <Alert tone="info" title={initial ? '프로필은 이렇게 쓰여요' : '라운지에서 쓸 프로필을 만들어요'}>
          닉네임·단과대·학번·아바타는 라운지에서 다른 학우에게 보여요. 학과는 &lsquo;같은 과 제외&rsquo;·&lsquo;같은 과만&rsquo; 매칭에만
          쓰이고 다른 사람에게는 보이지 않아요. 실명과 학교 메일은 보이지 않아요.
        </Alert>
      </div>

      <div className="lounge-gath-preview" aria-hidden="true">
        <Avatar user={{ avatar, avatarColor }} size="lg" />
        <div>
          <p className="bold">{nickname.trim() || '닉네임'}</p>
          <p className="text-sm text-sub">
            {college || '단과대'}
            {year ? ` · ${admissionLabel(Number(year))}` : ''}
          </p>
        </div>
      </div>

      <TextField
        id={fid('nickname')}
        label="닉네임"
        required
        value={nickname}
        autoComplete="off"
        spellCheck={false}
        help={`실명 대신 라운지에서 보이는 이름이에요. ${NICKNAME_MIN}~${NICKNAME_MAX}자 (지금 ${nickLen}자)`}
        error={errors.nickname}
        onChange={(e) => {
          setNickname(e.target.value);
          clear('nickname');
        }}
      />

      <SelectField
        id={fid('college')}
        label="단과대"
        required
        value={college}
        error={errors.college}
        onChange={(e) => {
          setCollege(e.target.value);
          clear('college');
        }}
      >
        <option value="">단과대를 골라 주세요</option>
        {COLLEGES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectField>

      <TextField
        id={fid('department')}
        label="학과"
        required
        value={department}
        autoComplete="off"
        placeholder="예) 컴퓨터공학부"
        help={
          <>
            같은 과 제외·같은 과만 매칭에만 쓰이고 다른 사람에게는 보이지 않아요.
            {initial
              ? ' 한 번 정하면 30일 동안 바꿀 수 없어요. 학교 계정을 연동하면 확인된 학과로 바로 맞출 수 있어요.'
              : hint?.department
                ? ' 학교 계정에서 가져온 학과예요.'
                : ''}
          </>
        }
        error={errors.department}
        onChange={(e) => {
          touched.current.department = true;
          setDepartment(e.target.value);
          clear('department');
        }}
      />

      <SelectField
        id={fid('admissionYear')}
        label="입학년도"
        required
        value={year}
        error={errors.admissionYear}
        help={year ? `라운지에는 ${admissionLabel(Number(year))}으로 보여요.` : undefined}
        onChange={(e) => {
          touched.current.year = true;
          setYear(e.target.value);
          clear('admissionYear');
        }}
      >
        <option value="">입학년도를 골라 주세요</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}년 ({admissionLabel(y)})
          </option>
        ))}
      </SelectField>

      <RadioGrid label="아바타 얼굴" value={avatar} onChange={setAvatar} items={faceItems} id={fid('avatar')} />
      <RadioGrid
        label="아바타 색"
        value={avatarColor}
        onChange={setAvatarColor}
        items={colorItems}
        help={`고른 색: ${COLOR_NAME[avatarColor]}`}
      />
    </form>
  );
}

/**
 * 아이콘 격자에서 하나 고르기 (role=radiogroup). 방향키로 이동하며 고르고, Tab 은 고른 항목 하나에만 머문다.
 * 선택은 색만이 아니라 굵은 테두리와 체크로도 표시한다.
 */
function RadioGrid<T extends string>({
  label,
  value,
  onChange,
  items,
  help,
  id,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; node: ReactNode }[];
  help?: string;
  id?: string;
}) {
  const auto = useId();
  const gid = id ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="field">
      <span className="field__label" id={`${gid}-label`}>
        {label}
      </span>
      <div className="lounge-gath-picks" role="radiogroup" aria-labelledby={`${gid}-label`} id={gid}>
        {items.map((it, i) => {
          const on = value === it.value;
          return (
            <button
              key={it.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={it.label}
              tabIndex={on ? 0 : -1}
              className="lounge-gath-pick"
              onClick={() => onChange(it.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {it.node}
              {on && (
                <span className="lounge-gath-pick__check" aria-hidden="true">
                  <Icon name="check" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {help && <p className="field__help">{help}</p>}
    </div>
  );
}
