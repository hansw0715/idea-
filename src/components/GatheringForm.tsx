'use client';

/**
 * 모임 만들기 폼. 미팅/밥약 공용. (담당: 한승원)
 *
 * 미팅은 인원 구성(2:2 등)을 고르고, 밥약은 총 인원만 고른다.
 * 그 차이가 곧 slots 프리셋 차이라서 폼도 그 부분만 갈라진다.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createGathering, ApiError } from '@/lib/api';
import { defaultLocalInput, localInputToISO } from '@/lib/format';
import { MEETUP_PRESETS, MEETUP_SIZES, type MeetupSize } from '@/features/meetup/preset';
import { MEAL_CAPACITY_OPTIONS, MEAL_PRESET } from '@/features/mealdate/preset';

type Props = { kind: 'meetup' | 'meal' };

const COPY = {
  meetup: {
    heading: '미팅 글쓰기',
    titlePlaceholder: '예) 금요일 저녁 2:2 미팅 하실 분!',
    bodyPlaceholder: '어떤 분위기로 만나고 싶은지 적어 주세요.',
    submit: '선착순으로 올리기',
    back: '/meetups',
  },
  meal: {
    heading: '밥약 만들기',
    titlePlaceholder: '예) 오늘 점심 학식 같이 드실 분',
    bodyPlaceholder: '몇 시에 어디서 만날지, 어떤 사람이면 좋을지 적어 주세요.',
    submit: '밥약 방 만들기',
    back: '/meals',
  },
} as const;

export function GatheringForm({ kind }: Props) {
  const router = useRouter();
  const copy = COPY[kind];

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [meetAt, setMeetAt] = useState(defaultLocalInput(24));
  const [deadline, setDeadline] = useState(defaultLocalInput(20));
  const [size, setSize] = useState<MeetupSize>('2:2');
  const [capacity, setCapacity] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGathering({
        kind,
        title,
        body,
        place,
        meetAt: localInputToISO(meetAt),
        joinDeadline: localInputToISO(deadline),
        joinPolicy: kind === 'meetup' ? 'auto' : 'approval',
        slots: kind === 'meetup' ? MEETUP_PRESETS[size].slots : MEAL_PRESET(capacity).slots,
      });
      router.push(copy.back);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '등록에 실패했어요.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-bold">{copy.heading}</h2>

      <Field label="제목">
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={copy.titlePlaceholder}
          className={inputClass}
        />
      </Field>

      <Field label="소개">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={copy.bodyPlaceholder}
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field label="장소">
        <input
          required
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="예) 상상관 앞, 삼선교 먹자골목"
          className={inputClass}
        />
      </Field>

      {kind === 'meetup' ? (
        <Field label="인원 구성" hint="선착순으로 빈 자리에 앉는 방식이라 구성이 안 깨져요.">
          <div className="grid grid-cols-4 gap-2">
            {MEETUP_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`rounded-xl py-2 text-sm font-bold ${
                  size === s ? 'bg-brand text-white' : 'border border-border text-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      ) : (
        <Field label="정원" hint="주최자인 나를 포함한 인원이에요.">
          <div className="grid grid-cols-5 gap-2">
            {MEAL_CAPACITY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCapacity(n)}
                className={`rounded-xl py-2 text-sm font-bold ${
                  capacity === n ? 'bg-brand text-white' : 'border border-border text-muted'
                }`}
              >
                {n}명
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="만나는 시간">
        <input
          type="datetime-local"
          required
          value={meetAt}
          onChange={(e) => setMeetAt(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="신청 마감" hint="마감 후에는 취소할 수 없어요. 노쇼를 줄이려는 장치예요.">
        <input
          type="datetime-local"
          required
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className={inputClass}
        />
      </Field>

      {error && <p className="text-sm font-medium text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? '올리는 중…' : copy.submit}
      </button>
    </form>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
