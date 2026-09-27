import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { DAY_NAMES, fmtRange } from '../time';

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

interface Props {
  /** 과목을 시간표에 담는다. 실패 사유를 문자열로 돌려주면 화면에 표시한다. */
  onAdd: (course: Course) => Promise<string | null>;
}

export default function CourseSearch({ onAdd }: Props) {
  const [terms, setTerms] = useState<Option[]>([]);
  const [majors, setMajors] = useState<Option[]>([]);
  const [term, setTerm] = useState('');
  const [major, setMajor] = useState('');
  const [grade, setGrade] = useState('');
  const [grades, setGrades] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ terms: Option[]; majors: Option[] }>('/courses/options')
      .then((o) => {
        setTerms(o.terms);
        setMajors(o.majors);
        setTerm(o.terms[0]?.code ?? '');
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : '학기 목록을 불러오지 못했습니다.'),
      );
  }, []);

  useEffect(() => {
    if (!term || !major) {
      setCourses(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ term, major });
    if (grade) params.set('grade', grade);
    if (query.trim()) params.set('q', query.trim());
    api
      .get<{ courses: Course[]; grades: string[] }>(`/courses?${params}`)
      .then((r) => {
        if (cancelled) return;
        setCourses(r.courses);
        setGrades(r.grades);
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
  }, [term, major, grade, query]);

  const majorGroups = useMemo(() => {
    const gyoyang = majors.filter((m) => m.code.startsWith('L'));
    const jeongong = majors.filter((m) => !m.code.startsWith('L'));
    return { gyoyang, jeongong };
  }, [majors]);

  async function add(course: Course) {
    setAdding(course.code + course.professor);
    const message = await onAdd(course);
    setAdding(null);
    if (message) setError(message);
    else setError(null);
  }

  return (
    <section className="card">
      <h2 className="card-title">과목 검색해서 담기</h2>
      <p className="row-sub" style={{ marginTop: -8, marginBottom: 16 }}>
        학교 강의시간표에서 찾아 클릭 한 번으로 넣습니다. 온라인 전용 과목은 시간이 없어 제외됩니다.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-row">
        <div className="field">
          <label htmlFor="cs-term">학기</label>
          <select
            id="cs-term"
            className="select"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          >
            {terms.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cs-grade">학년</label>
          <select
            id="cs-grade"
            className="select"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            disabled={!major}
          >
            <option value="">전체</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="field">
          <label htmlFor="cs-major">학과 · 교양</label>
          <select
            id="cs-major"
            className="select"
            value={major}
            onChange={(e) => {
              setMajor(e.target.value);
              setGrade('');
            }}
          >
            <option value="">선택하세요</option>
            <optgroup label="교양">
              {majorGroups.gyoyang.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="전공">
              {majorGroups.jeongong.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="cs-q">과목명 · 교수명 검색</label>
        <input
          id="cs-q"
          className="input"
          type="text"
          placeholder="예: 확률, 조혜경"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!major}
        />
      </div>

      {!major ? (
        <p className="empty-note">학과 또는 교양 분류를 먼저 선택해 주세요.</p>
      ) : loading ? (
        <p className="empty-note">불러오는 중…</p>
      ) : courses && courses.length === 0 ? (
        <p className="empty-note">조건에 맞는 과목이 없습니다.</p>
      ) : (
        courses && (
          <div className="row-list course-list">
            {courses.slice(0, 60).map((c) => {
              const key = c.code + c.professor + c.room;
              return (
                <div key={key} className="row-item">
                  <div className="grow">
                    <div className="row-main">
                      {c.name}{' '}
                      <span className="badge badge-neutral" style={{ marginLeft: 4 }}>
                        {c.category}
                      </span>
                    </div>
                    <div className="row-sub">
                      {c.slots
                        .map((s) => `${DAY_NAMES[s.day] ?? '?'} ${fmtRange(s.startMin, s.endMin)}`)
                        .join(', ')}
                      {c.room ? ` · ${c.room}` : ''}
                      {c.professor ? ` · ${c.professor}` : ''}
                      {c.grade ? ` · ${c.grade}` : ''}
                    </div>
                    {c.onlineNote && (
                      <div className="row-sub" style={{ color: 'var(--faint)' }}>
                        {c.onlineNote}은 대면 시간이 아니라 시간표에 넣지 않습니다.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => add(c)}
                    disabled={adding === c.code + c.professor}
                  >
                    담기
                  </button>
                </div>
              );
            })}
            {courses.length > 60 && (
              <p className="empty-note">
                {courses.length}개 중 60개만 표시했습니다. 검색어로 좁혀 보세요.
              </p>
            )}
          </div>
        )
      )}
    </section>
  );
}
