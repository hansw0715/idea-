import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { DAY_NAMES, fmtRange } from '../time';
import { Alert, Badge, Button, EmptyState, Icon, LoadingBlock, SelectField, TextField } from '../ui';
import './timetable.css';

interface CourseSlot {
  day: number;
  startMin: number;
  endMin: number;
}

export interface Course {
  code: string;
  name: string;
  category: string;
  credit: string;
  grade: string;
  professor: string;
  room: string;
  slots: CourseSlot[];
  onlineNote: string | null;
}

interface Option {
  code: string;
  name: string;
}

/** 담기에 실패했을 때 화면에 보여 줄 내용 */
export interface CourseAddFailure {
  message: string;
  /** true 면 일부 시간만 담긴 경우 (주의), 아니면 하나도 담지 못한 경우 (오류) */
  partial?: boolean;
}

interface Props {
  /** 과목을 시간표에 담는다. 모두 담았으면 null, 아니면 실패 내용을 돌려준다. */
  onAdd: (course: Course) => Promise<CourseAddFailure | null>;
}

/** 목록에 그리는 최대 개수 */
const LIST_LIMIT = 60;
/** 검색어를 입력한 뒤 요청을 보내기까지 기다리는 시간(ms) */
const QUERY_DEBOUNCE_MS = 250;

/** '3' → '3학년', '전학년' 은 그대로 */
function gradeText(grade: string): string {
  return /^\d+$/.test(grade) ? `${grade}학년` : grade;
}

/** 같은 과목 코드·교수·강의실이라도 분반마다 시간대가 다르므로 시간대까지 합쳐 구분한다. */
function courseKey(c: Course): string {
  return [c.code, c.professor, c.room, c.slots.map((s) => `${s.day}:${s.startMin}-${s.endMin}`).join(',')].join('|');
}

export default function CourseSearch({ onAdd }: Props) {
  const [terms, setTerms] = useState<Option[]>([]);
  const [majors, setMajors] = useState<Option[]>([]);
  const [optionsReady, setOptionsReady] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsTick, setOptionsTick] = useState(0);

  const [term, setTerm] = useState('');
  const [major, setMajor] = useState('');
  const [grade, setGrade] = useState('');
  const [grades, setGrades] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTick, setSearchTick] = useState(0);

  const [adding, setAdding] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, CourseAddFailure>>({});

  // 학기·학과 선택지
  useEffect(() => {
    let cancelled = false;
    setOptionsError(null);
    api
      .get<{ terms: Option[]; majors: Option[] }>('/courses/options')
      .then((o) => {
        if (cancelled) return;
        setTerms(o.terms);
        setMajors(o.majors);
        setTerm((current) => current || (o.terms[0]?.code ?? ''));
        setOptionsReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setOptionsError(err instanceof Error ? err.message : '학기 목록을 불러오지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [optionsTick]);

  // 검색어는 잠깐 멈췄을 때 반영해, 글자마다 요청을 보내지 않는다.
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(query), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // 과목 목록. 조건이 연달아 바뀌면 이전 요청의 응답은 버린다.
  useEffect(() => {
    if (!term || !major) {
      setCourses(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ term, major });
    if (grade) params.set('grade', grade);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    api
      .get<{ courses: Course[]; grades: string[] }>(`/courses?${params}`)
      .then((r) => {
        if (cancelled) return;
        setCourses(r.courses);
        setGrades(r.grades);
        setFailures({});
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '강의를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, major, grade, searchQuery, searchTick]);

  const majorGroups = useMemo(() => {
    const gyoyang = majors.filter((m) => m.code.startsWith('L'));
    const jeongong = majors.filter((m) => !m.code.startsWith('L'));
    return { gyoyang, jeongong };
  }, [majors]);

  async function add(course: Course, key: string) {
    setAdding(key);
    setFailures((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const failure = await onAdd(course);
    setAdding(null);
    if (failure) setFailures((prev) => ({ ...prev, [key]: failure }));
  }

  function onTermChange(value: string) {
    setTerm(value);
    setCourses(null);
  }

  function onMajorChange(value: string) {
    setMajor(value);
    setGrade('');
    setGrades([]);
    setCourses(null);
    setFailures({});
  }

  function clearFilters() {
    setQuery('');
    setSearchQuery('');
    setGrade('');
  }

  function onSubmit(e: FormEvent) {
    // 결과는 입력하는 대로 바로 바뀐다. 키보드의 "검색"은 키보드를 내리는 데만 쓴다.
    e.preventDefault();
    setSearchQuery(query);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // 그래도 완전히 같은 항목이 있으면 번호를 붙여 서로 다른 키로 만든다.
  const seen = new Map<string, number>();
  const shown = (courses?.slice(0, LIST_LIMIT) ?? []).map((course) => {
    const base = courseKey(course);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { course, key: n === 0 ? base : `${base}#${n}` };
  });
  const hasFilters = query.trim() !== '' || grade !== '';

  return (
    <section className="tt-cs" aria-label="과목 검색해서 담기">
      <p className="tt-cs__intro">
        학교 강의시간표에서 과목을 찾아 담기 한 번으로 시간표에 넣습니다. 온라인 전용 과목은 시간이
        없어 제외됩니다.
      </p>

      {optionsError && (
        <div className="tt-cs__alert">
          <Alert
            tone="danger"
            title="학기 목록을 불러오지 못했습니다."
            actions={
              <Button variant="secondary" onClick={() => setOptionsTick((n) => n + 1)}>
                다시 시도하기
              </Button>
            }
          >
            {optionsError}
          </Alert>
        </div>
      )}

      {error && !optionsError && (
        <div className="tt-cs__alert">
          <Alert
            tone="danger"
            title="과목을 불러오지 못했습니다."
            actions={
              <Button variant="secondary" onClick={() => setSearchTick((n) => n + 1)}>
                다시 시도하기
              </Button>
            }
          >
            {error}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} role="search" aria-label="과목 검색 조건" noValidate>
        <div className="tt-cs__pair">
          <SelectField
            label="학기"
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            disabled={!optionsReady && !optionsError}
          >
            {terms.length === 0 && <option value="">{optionsError ? '불러오지 못했습니다' : '불러오는 중…'}</option>}
            {terms.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="학년"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            disabled={!major}
            help={!major ? '학과를 먼저 골라 주세요.' : undefined}
          >
            <option value="">전체</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {gradeText(g)}
              </option>
            ))}
          </SelectField>
        </div>

        <SelectField
          label="학과 · 교양"
          value={major}
          onChange={(e) => onMajorChange(e.target.value)}
          disabled={!optionsReady}
        >
          <option value="">선택하세요</option>
          {majorGroups.gyoyang.length > 0 && (
            <optgroup label="교양">
              {majorGroups.gyoyang.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
          {majorGroups.jeongong.length > 0 && (
            <optgroup label="전공">
              {majorGroups.jeongong.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
        </SelectField>

        <TextField
          label="과목명 · 교수명 검색"
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="예: 확률, 조혜경"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!major}
        />
      </form>

      <div aria-live="polite">
        {!major ? (
          <EmptyState
            icon="search"
            title="학과 또는 교양 분류를 먼저 선택해 주세요."
            description="분류를 고르면 해당 과목이 이 아래에 나타납니다."
          />
        ) : !courses && loading ? (
          <LoadingBlock>과목을 불러오는 중입니다.</LoadingBlock>
        ) : courses && courses.length === 0 ? (
          <EmptyState
            icon="search"
            title="조건에 맞는 과목이 없습니다."
            description="검색어를 바꾸거나 학년을 '전체'로 바꿔 다시 찾아 보세요."
            action={
              hasFilters ? (
                <Button variant="tertiary" onClick={clearFilters}>
                  검색 조건 지우기
                </Button>
              ) : undefined
            }
          />
        ) : (
          courses && (
            <>
              <p className="tt-cs__count">총 {courses.length}개</p>
              <ul
                className={`list tt-cs__list${loading ? ' is-loading' : ''}`}
                aria-busy={loading || undefined}
              >
                {shown.map(({ course: c, key }) => {
                  const busy = adding === key;
                  const failure = failures[key];
                  const slotText = c.slots
                    .map((s) => `${DAY_NAMES[s.day] ?? '?'} ${fmtRange(s.startMin, s.endMin)}`)
                    .join(', ');
                  const meta = [c.room, c.professor, gradeText(c.grade)].filter(Boolean).join(' · ');
                  return (
                    <li key={key} className="tt-cs__row">
                      <div className="list__item tt-cs__item">
                        <div className="list__body">
                          <div className="tt-cs__name">
                            <span className="list__main">{c.name}</span>
                            {c.category && <Badge tone="gray">{c.category}</Badge>}
                          </div>
                          <p className="list__sub">{slotText}</p>
                          {meta && <p className="list__sub">{meta}</p>}
                          {c.onlineNote && (
                            <p className="list__sub tt-cs__online">
                              <Icon name="info" />
                              <span>{c.onlineNote}은 대면 시간이 아니라 시간표에 넣지 않습니다.</span>
                            </p>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="tt-cs__add"
                          loading={busy}
                          onClick={() => add(c, key)}
                          aria-label={`${c.name} 담기`}
                        >
                          {busy ? '담는 중…' : '담기'}
                        </Button>
                      </div>
                      {failure && (
                        <Alert tone={failure.partial ? 'warning' : 'danger'}>{failure.message}</Alert>
                      )}
                    </li>
                  );
                })}
              </ul>
              {courses.length > LIST_LIMIT && (
                <p className="tt-cs__more">
                  {courses.length}개 중 {LIST_LIMIT}개만 표시했습니다. 검색어로 좁혀 보세요.
                </p>
              )}
            </>
          )
        )}
      </div>
    </section>
  );
}
