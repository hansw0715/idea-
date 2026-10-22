import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  MEAL_CAPACITY_OPTIONS,
  MEAL_JOIN_POLICY,
  MEAL_PRESET,
  MEAL_TAGS,
  MEETUP_JOIN_POLICY,
  MEETUP_PRESETS,
  MEETUP_SIZES,
  MENU_CATEGORIES,
  PLACE_TYPES,
  defaultLocalInput,
  localInputToISO,
} from '../../../../shared/lounge';
import type { GatheringKind, GatheringView, MeetupSize, PlaceType } from '../../../../shared/lounge';
import { Alert, Button, Choice, Icon, Segmented, SelectField, Sheet, TextField, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import TextAreaField from '../parts/TextAreaField';
import '../gathering.css';

/**
 * 자리 만들기 시트 — 미팅("N:N 할 사람?" 한 줄 글쓰기 + 상세 설정) / 밥약(정원·장소 종류·메뉴·태그).
 * 담당: 작업 C2.
 *
 * 계약(props)은 바꾸지 말고, 필요하면 선택(optional) props 만 추가한다.
 *  - kind: 'meetup' | 'meal' ('team' 은 이번 단계에서 만들지 않는다)
 *  - onCreated: 서버가 만든 모임 view. 호출한 쪽이 지도에 테이블을 바로 그린다.
 *  - PROFILE_REQUIRED 오류는 useLounge().handleError(err) 로 처리한다.
 */
export type CreateGatheringSheetProps = {
  open: boolean;
  kind: Extract<GatheringKind, 'meetup' | 'meal'>;
  onClose: () => void;
  onCreated: (g: GatheringView) => void;
};

const TITLE_MAX = 60;
const PLACE_MAX = 40;
const BODY_MAX = 300;
const HOUR_MS = 3_600_000;
const MIN_LEAD_MS = 2 * 60_000;
const HORIZON_DAYS = 365;

type Field = 'title' | 'place' | 'meetAt' | 'deadline' | 'body';
const FIELD_ORDER: Field[] = ['title', 'body', 'place', 'meetAt', 'deadline'];
type Errors = Partial<Record<Field, string>>;

/** Date → datetime-local 입력값 "YYYY-MM-DDTHH:mm" (기기 시간대) */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 신청 마감 기본값: 약속 2시간 전. 약속이 2시간 안으로 다가왔으면 "지금 바로 다음"으로 두되,
 * 마감이 약속보다 늦어질 수는 없으니 약속 1분 전을 넘지 않게 자른다(clamp).
 * 입력이 비었거나 잘못되면 빈 문자열.
 */
function autoDeadline(meetLocal: string, now: number = Date.now()): string {
  const meet = new Date(meetLocal).getTime();
  if (!Number.isFinite(meet)) return '';
  const wanted = Math.max(meet - 2 * HOUR_MS, now + 60_000);
  return toLocalInput(new Date(Math.min(wanted, meet - 60_000)));
}

const codePoints = (s: string) => [...s].length;

/** 서버 오류 문장에서 어느 입력칸 이야기인지 짐작 — 맞으면 그 칸 아래에 보여 준다 (못 맞히면 폼 위 알림) */
function fieldOfServerMessage(message: string): Field | null {
  if (message.includes('신청 마감')) return 'deadline';
  if (message.includes('만나는 시각') || message.includes('지난 시각')) return 'meetAt';
  if (message.includes('제목')) return 'title';
  if (message.includes('장소')) return 'place';
  if (message.includes('내용')) return 'body';
  return null;
}

export default function CreateGatheringSheet({ open, kind, onClose, onCreated }: CreateGatheringSheetProps) {
  const confirm = useConfirm();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);

  // 열 때마다 새 입력으로 시작한다: 열리는 순간 key 를 올려 안쪽 폼을 새로 만든다.
  // (닫는 400ms 동안은 같은 key 라 입력이 그대로 보이며 내려가고, 닫힌 뒤에는 Sheet 가 내용을 치운다)
  const prevOpen = useRef(false);
  const session = useRef(0);
  if (open && !prevOpen.current) session.current += 1;
  prevOpen.current = open;

  /** 작성 중인 내용이 있는데 배경을 눌러 닫아 버리는 사고를 막는다 */
  async function requestClose() {
    if (busy) return;
    if (dirtyRef.current) {
      const ok = await confirm({
        title: '작성을 그만할까요?',
        message: '적은 내용이 사라져요.',
        tone: 'danger',
        confirmLabel: '그만하기',
        cancelLabel: '계속 쓰기',
      });
      if (!ok) return;
    }
    onClose();
  }

  const label = kind === 'meetup' ? '미팅' : '밥약';
  return (
    <Sheet
      open={open}
      onClose={requestClose}
      title={`${label} 자리 만들기`}
      initialFocus="input, textarea, select"
      footer={
        <Button type="submit" form={formId} variant="primary" loading={busy}>
          {busy ? '올리는 중…' : '올리기'}
        </Button>
      }
    >
      <CreateForm
        key={session.current}
        kind={kind}
        formId={formId}
        dirtyRef={dirtyRef}
        onBusy={setBusy}
        onCreated={(g) => {
          dirtyRef.current = false;
          onCreated(g);
          onClose();
        }}
      />
    </Sheet>
  );
}

function CreateForm({
  kind,
  formId,
  dirtyRef,
  onBusy,
  onCreated,
}: {
  kind: 'meetup' | 'meal';
  formId: string;
  dirtyRef: { current: boolean };
  onBusy: (busy: boolean) => void;
  onCreated: (g: GatheringView) => void;
}) {
  const toast = useToast();
  const { handleError } = useLounge();
  const uid = useId();
  const fid = (f: Field) => `${uid}-${f}`;

  const [size, setSize] = useState<MeetupSize>('2:2');
  const [capacity, setCapacity] = useState<number>(2);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [meetAt, setMeetAt] = useState(() => defaultLocalInput(24));
  const [deadlineEdited, setDeadlineEdited] = useState<string | null>(null);
  const [placeType, setPlaceType] = useState<PlaceType>('학식');
  const [menu, setMenu] = useState<string>(MENU_CATEGORIES[0]);
  const [tags, setTags] = useState<string[]>([]);
  const [excludeSameDept, setExcludeSameDept] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // 마감을 직접 고치지 않았다면 약속 시간을 따라간다.
  const deadline = deadlineEdited ?? autoDeadline(meetAt);

  dirtyRef.current = title.trim() !== '' || body.trim() !== '' || place.trim() !== '' || tags.length > 0;

  // 입력이 바뀌면 그 칸의 오류는 지운다 (고치는 중에도 빨간 글씨가 남아 있지 않게)
  const clear = (f: Field) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  function validate(): Errors {
    const e: Errors = {};
    const t = title.trim();
    if (codePoints(t) < 1) {
      e.title = kind === 'meetup' ? '한 줄 소개가 비어 있어요. 어떤 자리인지 한 줄로 적어 주세요.' : '제목이 비어 있어요. 어떤 밥약인지 한 줄로 적어 주세요.';
    } else if (codePoints(t) > TITLE_MAX) {
      e.title = `${TITLE_MAX}자까지 쓸 수 있어요. 조금 줄여 주세요.`;
    }
    if (codePoints(body.trim()) > BODY_MAX) e.body = `소개는 ${BODY_MAX}자까지 쓸 수 있어요.`;
    const p = place.trim();
    if (codePoints(p) < 1) e.place = '장소가 비어 있어요. 만날 곳을 적어 주세요.';
    else if (codePoints(p) > PLACE_MAX) e.place = `장소는 ${PLACE_MAX}자까지 쓸 수 있어요.`;

    const now = Date.now();
    const meet = meetAt ? new Date(meetAt).getTime() : NaN;
    if (!Number.isFinite(meet)) e.meetAt = '만나는 시간을 골라 주세요.';
    else if (meet <= now) e.meetAt = '이미 지난 시간이에요. 지금보다 뒤의 시간을 골라 주세요.';
    else if (meet < now + MIN_LEAD_MS) e.meetAt = '너무 가까운 시간이에요. 지금부터 2분 뒤 이후로 골라 주세요.';
    else if (meet > now + HORIZON_DAYS * 24 * HOUR_MS) e.meetAt = `${HORIZON_DAYS}일 안의 시간으로 골라 주세요.`;

    if (!e.meetAt) {
      const dl = deadline ? new Date(deadline).getTime() : NaN;
      if (!Number.isFinite(dl)) e.deadline = '신청 마감 시간을 골라 주세요.';
      else if (dl > meet) e.deadline = '신청 마감은 만나는 시간보다 앞이어야 해요.';
      else if (dl <= now) e.deadline = '신청 마감은 지금보다 뒤여야 해요.';
    }
    return e;
  }

  function focusField(f: Field) {
    // 접힌 상세 안의 칸이면 먼저 펼친 뒤 포커스
    if (kind === 'meetup' && (f === 'body' || f === 'deadline')) setDetailsOpen(true);
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
    setBusy(true);
    onBusy(true);
    try {
      const meetISO = localInputToISO(meetAt);
      const common = {
        title: title.trim(),
        body: body.trim(),
        place: place.trim(),
        meetAt: meetISO,
        joinDeadline: localInputToISO(deadline),
      };
      // 자리 구성은 서버가 프리셋으로 다시 만든다. 우리는 프리셋 그대로 보낸다.
      const view =
        kind === 'meetup'
          ? await loungeApi.createGathering({
              kind: 'meetup',
              ...common,
              joinPolicy: MEETUP_JOIN_POLICY,
              slots: MEETUP_PRESETS[size].slots,
              meta: { tags: [size, ...(excludeSameDept ? ['같은 과 제외'] : [])], excludeSameDept },
            })
          : await loungeApi.createGathering({
              kind: 'meal',
              ...common,
              joinPolicy: MEAL_JOIN_POLICY,
              slots: MEAL_PRESET(capacity).slots,
              meta: { placeType, menu, tags },
            });
      toast('자리를 만들었어요.');
      onCreated(view);
    } catch (err) {
      if (handleError(err)) {
        // 프로필 시트가 위에 열린다. 입력은 그대로 두고, 프로필을 만든 뒤 다시 올리면 된다.
        setFormError('라운지 프로필을 먼저 만들어 주세요. 프로필을 만든 뒤 다시 올려 주세요. 적은 내용은 그대로 남아 있어요.');
      } else {
        const message = err instanceof Error ? err.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
        const field = fieldOfServerMessage(message);
        if (field) {
          setErrors({ [field]: message });
          focusField(field);
        } else {
          setFormError(message);
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const sizeOptions = MEETUP_SIZES.map((s) => ({ value: s, label: s }));
  const capacityOptions = MEAL_CAPACITY_OPTIONS.map((n) => ({ value: String(n), label: `${n}명` }));
  const placeTypeOptions = PLACE_TYPES.map((p) => ({ value: p, label: p }));

  return (
    <form id={formId} noValidate onSubmit={submit} className="lounge-gath-form">
      {formError && (
        <div ref={alertRef} tabIndex={-1} className="lounge-gath-gap">
          <Alert tone="danger" title="자리를 만들지 못했어요.">
            {formError}
          </Alert>
        </div>
      )}

      {kind === 'meetup' ? (
        <>
          <Segmented
            label="인원"
            value={size}
            onChange={setSize}
            options={sizeOptions}
          />
          <TextField
            id={fid('title')}
            label="한 줄 소개"
            required
            value={title}
            maxLength={TITLE_MAX}
            help={`${title.length}/${TITLE_MAX}`}
            error={errors.title}
            onChange={(e) => {
              setTitle(e.target.value);
              clear('title');
            }}
          />
          <TextField
            id={fid('place')}
            label="장소"
            required
            value={place}
            maxLength={PLACE_MAX}
            error={errors.place}
            onChange={(e) => {
              setPlace(e.target.value);
              clear('place');
            }}
          />
          <TextField
            id={fid('meetAt')}
            label="시간"
            required
            type="datetime-local"
            value={meetAt}
            min={toLocalInput(new Date())}
            error={errors.meetAt}
            onChange={(e) => {
              setMeetAt(e.target.value);
              clear('meetAt');
              clear('deadline');
            }}
          />
          <Choice
            type="checkbox"
            label="같은 과는 빼고"
            checked={excludeSameDept}
            onChange={(e) => setExcludeSameDept(e.target.checked)}
          />

          <div className="lounge-gath-disclosure">
            <button
              type="button"
              className="lounge-gath-disclosure__toggle"
              aria-expanded={detailsOpen}
              aria-controls={`${uid}-details`}
              onClick={() => setDetailsOpen((o) => !o)}
            >
              <span>상세 설정</span>
              <span className="lounge-gath-disclosure__hint">소개 · 신청 마감</span>
              <Icon name={detailsOpen ? 'chevron-up' : 'chevron-down'} />
            </button>
            <div id={`${uid}-details`} hidden={!detailsOpen} className="lounge-gath-disclosure__panel">
              <TextAreaField
                id={fid('body')}
                label="소개"
                placeholder="소개 (선택)"
                value={body}
                maxLength={BODY_MAX}
                error={errors.body}
                onChange={(e) => {
                  setBody(e.target.value);
                  clear('body');
                }}
              />
              <DeadlineField
                id={fid('deadline')}
                value={deadline}
                edited={deadlineEdited !== null}
                error={errors.deadline}
                onChange={(v) => {
                  setDeadlineEdited(v);
                  clear('deadline');
                }}
                onReset={() => {
                  setDeadlineEdited(null);
                  clear('deadline');
                }}
              />
            </div>
          </div>
          {!detailsOpen && deadline && (
            <p className="field__help lounge-gath-autoline">
              신청 마감 {deadlineLabel(deadline)}
            </p>
          )}
          {errors.deadline && !detailsOpen && (
            <p className="field__error">
              <Icon name="alert" />
              <span>{errors.deadline}</span>
            </p>
          )}
        </>
      ) : (
        <>
          <Segmented
            label="정원"
            value={String(capacity)}
            onChange={(v) => setCapacity(Number(v))}
            options={capacityOptions}
          />
          <TextField
            id={fid('title')}
            label="제목"
            required
            value={title}
            maxLength={TITLE_MAX}
            help={`${title.length}/${TITLE_MAX}`}
            error={errors.title}
            onChange={(e) => {
              setTitle(e.target.value);
              clear('title');
            }}
          />
          <TextAreaField
            id={fid('body')}
            label="소개"
            placeholder="자세한 내용 (선택)"
            value={body}
            maxLength={BODY_MAX}
            error={errors.body}
            onChange={(e) => {
              setBody(e.target.value);
              clear('body');
            }}
          />
          <TextField
            id={fid('place')}
            label="장소"
            required
            value={place}
            maxLength={PLACE_MAX}
            error={errors.place}
            onChange={(e) => {
              setPlace(e.target.value);
              clear('place');
            }}
          />
          <Segmented label="장소 종류" value={placeType} onChange={setPlaceType} options={placeTypeOptions} />
          <SelectField label="메뉴" value={menu} onChange={(e) => setMenu(e.target.value)}>
            {MENU_CATEGORIES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
          <div className="field" role="group" aria-labelledby={`${uid}-tags`}>
            <span className="field__label" id={`${uid}-tags`}>
              태그
            </span>
            <div className="tag-group">
              {MEAL_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className="tag"
                    aria-pressed={on}
                    onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                  >
                    <Icon name="check" className="tag__check" />
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <TextField
            id={fid('meetAt')}
            label="만나는 시간"
            required
            type="datetime-local"
            value={meetAt}
            min={toLocalInput(new Date())}
            error={errors.meetAt}
            onChange={(e) => {
              setMeetAt(e.target.value);
              clear('meetAt');
              clear('deadline');
            }}
          />
          <DeadlineField
            id={fid('deadline')}
            value={deadline}
            edited={deadlineEdited !== null}
            error={errors.deadline}
            onChange={(v) => {
              setDeadlineEdited(v);
              clear('deadline');
            }}
            onReset={() => {
              setDeadlineEdited(null);
              clear('deadline');
            }}
          />
        </>
      )}
    </form>
  );
}

/** "10/9(금) 오후 5:00" 같은 사람이 읽는 마감 표기 */
function deadlineLabel(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${mm}`;
}

/** 신청 마감 입력. 마감 뒤에는 참여를 취소할 수 없다는 점(노쇼를 줄이려는 장치)을 도움말로 알린다. */
function DeadlineField({
  id,
  value,
  edited,
  error,
  onChange,
  onReset,
}: {
  id: string;
  value: string;
  edited: boolean;
  error?: string;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <div>
      <TextField
        id={id}
        label="신청 마감"
        required
        type="datetime-local"
        value={value}
        min={toLocalInput(new Date())}
        error={error}
        help="마감 뒤에는 참여를 취소할 수 없어요."
        onChange={(e) => onChange(e.target.value)}
      />
      {edited && (
        <Button variant="text" onClick={onReset}>
          약속 2시간 전으로 되돌리기
        </Button>
      )}
    </div>
  );
}
