'use client';

/**
 * 미팅 라운지. (담당: 한승원)
 *
 * 카톡 단톡방에 "2:2 할 사람?" 하고 올리면 사람들이 반응해서 선착순으로 자리가 차는 느낌 그대로다.
 * 위쪽 한 줄 입력이 글쓰기, 아래는 올라온 글들이다. 자리가 다 차면 그 네 명만의 단톡방이 열린다.
 *
 * 개인이 아무 데나 붙으면 2:2 구성이 깨지므로 자리는 '우리 쪽 / 상대 쪽'으로 나뉜다.
 */
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { GatheringFeed } from '@/components/GatheringFeed';
import { ApiError, createGathering } from '@/lib/api';
import { defaultLocalInput, localInputToISO } from '@/lib/format';
import { MEETUP_PRESETS, MEETUP_SIZES, type MeetupSize } from '@/features/meetup/preset';

/** 신청 마감은 약속 2시간 전. 라운지에서 매번 고르게 하면 글쓰기가 귀찮아진다. */
const DEADLINE_BEFORE_MS = 2 * 3600_000;

export function MeetupLounge() {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<MeetupSize>('2:2');
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [meetAt, setMeetAt] = useState(defaultLocalInput(24));
  const [excludeSameDept, setExcludeSameDept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const meetAtISO = localInputToISO(meetAt);
      // 약속이 2시간 안 남았으면 마감은 "지금 바로 다음"으로 둔다 (도메인이 마감 < 약속을 요구한다)
      const deadline = new Date(Math.max(new Date(meetAtISO).getTime() - DEADLINE_BEFORE_MS, Date.now() + 60_000));

      await createGathering({
        kind: 'meetup',
        title: title.trim(),
        body: '',
        place: place.trim(),
        meetAt: meetAtISO,
        joinDeadline: new Date(Math.min(deadline.getTime(), new Date(meetAtISO).getTime() - 60_000)).toISOString(),
        joinPolicy: 'auto',
        slots: MEETUP_PRESETS[size].slots,
        meta: { tags: [size, ...(excludeSameDept ? ['같은 과 제외'] : [])], excludeSameDept },
      });
      setTitle('');
      setPlace('');
      setOpen(false);
      setReloadToken((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '올리지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-bold">미팅 라운지</h2>
        <p className="text-xs text-muted">
          “{size} 할 사람?” 올리면 선착순으로 자리가 차요. 다 차면 그 사람들만의 단톡방이 열려요.
        </p>
      </header>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-brand bg-brand-soft px-4 py-3 text-left text-sm font-semibold text-brand"
        >
          💌 미팅 할 사람? 올리기
        </button>
      ) : (
        <Card className="space-y-3 md:max-w-2xl">
          <Field label="인원" hint="우리 쪽 / 상대 쪽으로 자리가 나뉘어요.">
            <div className="grid grid-cols-4 gap-2">
              {MEETUP_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={cx(
                    'rounded-md py-2 text-sm font-bold transition',
                    size === s ? 'bg-brand text-white' : 'border border-border text-muted',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="한 줄 소개">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`예) 금요일 저녁 ${size} 하실 분!`}
              maxLength={60}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="장소">
              <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예) 삼선교" />
            </Field>
            <Field label="시간">
              <Input type="datetime-local" value={meetAt} onChange={(e) => setMeetAt(e.target.value)} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={excludeSameDept}
              onChange={(e) => setExcludeSameDept(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            같은 과는 빼고 (아는 사람 마주치지 않게)
          </label>

          {error && <Badge tone="danger">{error}</Badge>}

          <div className="flex gap-2">
            <Button block disabled={busy || !title.trim() || !place.trim()} onClick={post}>
              올리기
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </div>
        </Card>
      )}

      <GatheringFeed
        kind="meetup"
        newHref="/meetups/new"
        ctaLabel="자세히 쓰기 (소개·마감 직접 설정)"
        emptyText="아직 올라온 미팅이 없어요. 먼저 올려보세요!"
        reloadToken={reloadToken}
      />
    </section>
  );
}
