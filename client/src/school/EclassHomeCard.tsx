import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Icon } from '../ui';
import type { EclassItem, EclassSnapshot } from '../../../shared/school/eclass';
import { isAvailable, needsAttention, sortItems } from './eclassLogic';
import { useSchool } from './SchoolContext';

/** 홈 요약 카드에 보여 줄 미수강 강의 수 */
const SHOW = 3;

/** e-class 결과가 새로 저장되면 알리는 이벤트 (EclassHome 이 저장할 때 보낸다) */
export const ECLASS_UPDATED_EVENT = 'sangsang-booke:eclass-updated';

const cacheKey = (userId: number) => `sangsang-booke:eclass:${userId}`;

function readSnapshot(userId: number): EclassSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const s = JSON.parse(raw) as EclassSnapshot;
    return Array.isArray(s?.items) ? s : null;
  } catch {
    return null;
  }
}

/** "[01]자료구조 NEW" → "자료구조" */
function courseLabel(name: string): string {
  const cleaned = name.replace(/\[[^\]]*\]/g, '').replace(/NEW.*$/i, '').replace(/\s+/g, ' ').trim();
  return cleaned || name;
}

/**
 * 홈 옆으로 넘기는 요약 카드의 세 번째: "미수강 강의" + 아직 안 들은 강의 이름 (› 이름).
 * 아래 미수강 강의 구역이 이 기기에 저장해 둔 e-class 결과를 그대로 읽는다 (따로 학교에 묻지 않는다).
 */
export default function EclassHomeCard() {
  const { user } = useAuth();
  const school = useSchool();
  const [items, setItems] = useState<EclassItem[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      const snap = readSnapshot(user.id);
      const now = Date.now();
      setItems(
        snap
          ? sortItems(
              snap.items.filter((i) => i.kind === 'lecture' && isAvailable(i, now) && needsAttention(i, now)),
              now,
            )
          : null,
      );
    };
    load();
    window.addEventListener(ECLASS_UPDATED_EVENT, load);
    return () => window.removeEventListener(ECLASS_UPDATED_EVENT, load);
  }, [user]);

  const scrollToSection = () =>
    document.getElementById('eclass-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let body;
  if (!school.linked) body = <p className="home-card__sub">학교 계정을 연동하면 볼 수 있어요.</p>;
  else if (items === null) body = <p className="home-card__sub">불러오는 중이에요.</p>;
  else if (items.length === 0) body = <p className="home-card__sub">남은 강의가 없어요.</p>;
  else
    body = (
      <ul className="home-card__list">
        {items.slice(0, SHOW).map((i) => (
          <li key={i.id} className="home-card__line">
            <Icon name="chevron-right" />
            <span>{courseLabel(i.courseName)}</span>
          </li>
        ))}
        {items.length > SHOW && <li className="home-card__more-count">외 {items.length - SHOW}개</li>}
      </ul>
    );

  return (
    <article className="home-card home-card--green">
      <h2 className="home-card__title">미수강 강의</h2>
      {body}
      <button type="button" className="home-card__more" onClick={scrollToSection}>
        자세히 보기
        <Icon name="chevron-right" />
      </button>
    </article>
  );
}
