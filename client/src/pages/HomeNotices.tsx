import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { NoticeItem, NoticeSection, NoticesResponse } from '../../../shared/notices/types';

/** 처음에 보여 주는 공지 수. 나머지는 "모두 보기"로 펼친다 */
const SHOW = 5;

/** 오늘 날짜 YYYY-MM-DD (한국 시간) — 오늘 올라온 글에 N 표시 */
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** "2026-10-22" → "10.22" */
const shortDate = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;

/** 학교 공지·학과 공지 패널이 같은 화면에서 동시에 불러올 때 요청을 한 번만 보낸다 */
let inflight: Promise<NoticesResponse> | null = null;
function loadNotices(): Promise<NoticesResponse> {
  if (!inflight) {
    inflight = api.get<NoticesResponse>('/notices');
    // 끝나면 비워서 다음에 홈을 열 때는 새로 읽는다
    void inflight.catch(() => undefined).finally(() => setTimeout(() => (inflight = null), 0));
  }
  return inflight;
}

/**
 * 홈의 학교 공지 / 내 학과 공지 패널 — 최근 2주 안에 올라온 글을 학교 홈페이지에서 읽어 보여 준다.
 * 넓은 화면에서 두 열의 길이를 맞추려고 패널을 하나씩 따로 놓는다(part).
 * 홈의 다른 구역과 따로 불러온다(학교 홈페이지가 느려도 위 구역은 먼저 보인다).
 */
export default function HomeNotices({ part }: { part: 'school' | 'department' }) {
  const [data, setData] = useState<NoticesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadNotices()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayKst();
  const days = data?.days ?? 14;

  if (part === 'school') {
    return (
      <NoticeTable
        id="home-notice-school"
        title="학교 공지"
        section={data?.school ?? null}
        loading={!data && !failed}
        failed={failed}
        days={days}
        today={today}
      />
    );
  }

  if (data && data.department) {
    return (
      <NoticeTable
        id="home-notice-dept"
        title={`${data.department.name} 공지`}
        section={data.department}
        loading={false}
        failed={false}
        days={days}
        today={today}
      />
    );
  }

  return (
    <section className="home-panel home-panel--notice" aria-labelledby="home-notice-dept">
      <div className="home-panel__head">
        <h2 className="home-panel__title" id="home-notice-dept">
          {data?.departmentName ? `${data.departmentName} 공지` : '학과 공지'}
        </h2>
      </div>
      <p className="home-panel__empty">
        {!data && !failed ? (
          '불러오는 중이에요.'
        ) : failed ? (
          '공지를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'
        ) : data?.departmentName ? (
          '우리 학과 공지 게시판을 찾지 못했어요.'
        ) : (
          <>
            학교 계정을 연동하면 내 학과 공지를 볼 수 있어요. <Link to="/account">연동하기</Link>
          </>
        )}
      </p>
    </section>
  );
}

interface NoticeTableProps {
  id: string;
  title: string;
  section: NoticeSection | null;
  loading: boolean;
  failed: boolean;
  days: number;
  today: string;
}

function NoticeTable({ id, title, section, loading, failed, days, today }: NoticeTableProps) {
  const [open, setOpen] = useState(false);
  const items = section?.items ?? [];
  const shown = open ? items : items.slice(0, SHOW);

  let empty: string | null = null;
  if (loading) empty = '불러오는 중이에요.';
  else if (failed || section?.failed) empty = '학교 홈페이지에서 공지를 읽지 못했어요. 잠시 후 다시 열어 주세요.';
  else if (items.length === 0) empty = `최근 ${days}일 동안 올라온 공지가 없어요.`;

  return (
    <section className="home-panel home-panel--notice" aria-labelledby={id}>
      <div className="home-panel__head">
        <h2 className="home-panel__title" id={id}>
          {title}
        </h2>
        {items.length > 0 && <span className="home-panel__count tabular">{items.length}건</span>}
        {section && (
          <a href={section.url} target="_blank" rel="noreferrer" className="home-panel__link">
            학교 홈페이지
          </a>
        )}
      </div>
      {empty ? (
        <p className="home-panel__empty">{empty}</p>
      ) : (
        <>
          <ul className="home-rows">
            {shown.map((n) => (
              <NoticeRow key={n.id} notice={n} isNew={n.date === today} />
            ))}
          </ul>
          {items.length > SHOW && (
            <button type="button" className="home-panel__more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? '접기' : `최근 ${days}일 공지 ${items.length}건 모두 보기`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** 공지 한 줄: 제목 · 날짜 · 오늘 올라온 글이면 N. 누르면 학교 홈페이지 원문이 새 창으로 열린다 */
function NoticeRow({ notice, isNew }: { notice: NoticeItem; isNew: boolean }) {
  return (
    <li>
      <a href={notice.url} target="_blank" rel="noreferrer" className="home-row" title={notice.title}>
        <span className="home-row__body">
          <span className="home-notice__title">{notice.title}</span>
        </span>
        {isNew && (
          <span className="home-notice__new" aria-label="오늘 올라온 공지">
            N
          </span>
        )}
        <span className="home-notice__date tabular">{shortDate(notice.date)}</span>
      </a>
    </li>
  );
}
