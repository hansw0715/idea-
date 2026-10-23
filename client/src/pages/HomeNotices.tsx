import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../ui';
import type { NoticeItem, NoticeSection, NoticesResponse } from '../../../shared/notices/types';

/** 오늘 날짜 YYYY-MM-DD (한국 시간) — 오늘 올라온 글에 N 표시 */
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** "2026-10-22" → "10.22" */
const shortDate = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;

/**
 * 홈의 "학교 공지 → 내 학과 공지" — 가장 최근에 올라온 글 5개씩을 학교 홈페이지에서 읽어 표로 보여 준다.
 * 더 보려면 "더 보기"로 학교 홈페이지 게시판을 연다.
 * 홈의 다른 구역과 따로 불러온다(학교 홈페이지가 느려도 위 구역은 먼저 보인다).
 */
export default function HomeNotices() {
  // 지난번에 받은 공지가 있으면 먼저 보여 준다
  const [data, setData] = useState<NoticesResponse | null>(() => api.cached<NoticesResponse>('/notices') ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<NoticesResponse>('/notices')
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayKst();

  return (
    <>
      <NoticeTable
        id="home-notice-school"
        panel
        title="학교 공지"
        section={data?.school ?? null}
        loading={!data && !failed}
        failed={failed}
        today={today}
      />

      {data && data.department ? (
        <NoticeTable
          id="home-notice-dept"
          panel
          title={`${data.department.name} 공지`}
          section={data.department}
          loading={false}
          failed={false}
          today={today}
        />
      ) : (
        <section className="home-table home-table--panel" aria-labelledby="home-notice-dept">
          <div className="home-sum__head">
            <h2 className="home-sum__title" id="home-notice-dept">
              {data?.departmentName ? `${data.departmentName} 공지` : '학과 공지'}
            </h2>
          </div>
          <div className="home-table__box">
            <p className="home-sum__empty">
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
          </div>
        </section>
      )}
    </>
  );
}

interface NoticeTableProps {
  id: string;
  /** 옅은 회색 면 상자로 (학교·학과 공지) */
  panel?: boolean;
  title: string;
  section: NoticeSection | null;
  loading: boolean;
  failed: boolean;
  today: string;
}

function NoticeTable({ id, title, section, loading, failed, today, panel = false }: NoticeTableProps) {
  const items = section?.items ?? [];

  let empty: string | null = null;
  if (loading) empty = '불러오는 중이에요.';
  else if (failed || section?.failed) empty = '학교 홈페이지에서 공지를 읽지 못했어요. 잠시 후 다시 열어 주세요.';
  else if (items.length === 0) empty = '아직 올라온 공지가 없어요.';

  return (
    <section className={`home-table${panel ? ' home-table--panel' : ''}`} aria-labelledby={id}>
      <div className="home-sum__head">
        <h2 className="home-sum__title" id={id}>
          {title}
        </h2>
        {section && (
          <a href={section.url} target="_blank" rel="noreferrer" className="home-sum__link">
            더 보기
            <Icon name="chevron-right" />
          </a>
        )}
      </div>
      {empty ? (
        <div className="home-table__box">
          <p className="home-sum__empty">{empty}</p>
        </div>
      ) : (
        <ul className="home-table__box">
          {items.map((n) => (
            <NoticeRow key={n.id} notice={n} isNew={n.date === today} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 공지 한 줄: 제목 · 날짜 · 오늘 올라온 글이면 N. 누르면 학교 홈페이지 원문이 새 창으로 열린다 */
function NoticeRow({ notice, isNew }: { notice: NoticeItem; isNew: boolean }) {
  return (
    <li>
      <a href={notice.url} target="_blank" rel="noreferrer" className="home-table__row" title={notice.title}>
        <span className="home-table__preview home-notice__title">{notice.title}</span>
        <span className="home-notice__date tabular">{shortDate(notice.date)}</span>
        {isNew && (
          <span className="home-table__count" aria-label="오늘 올라온 공지">
            N
          </span>
        )}
      </a>
    </li>
  );
}
