import { Router } from 'express';
import { requireAuth, wrap } from './auth.js';
import { getOptions, getCourses } from './courses.js';

export const coursesRouter = Router();

coursesRouter.use(requireAuth);

/** 학기·전공(교양 포함) 선택지 */
coursesRouter.get(
  '/options',
  wrap(async (_req, res) => {
    try {
      res.json(await getOptions());
    } catch (err) {
      console.error('[courses] 선택지 조회 실패:', err);
      res.status(503).json({ error: '학교 강의시간표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  }),
);

/**
 * 강의 검색.
 * term(학기), major(전공/교양 코드)는 필수, grade(학년)·q(과목명·교수)는 선택.
 * 온라인 전용 과목은 시간표에 넣을 수 없으므로 제외한다.
 */
coursesRouter.get(
  '/',
  wrap(async (req, res) => {
    const term = String(req.query.term ?? '');
    const major = String(req.query.major ?? '');
    const grade = String(req.query.grade ?? '').trim();
    const q = String(req.query.q ?? '').trim().toLowerCase();

    if (!/^\d{5}$/.test(term) || !/^[A-Z0-9]{3,6}$/.test(major)) {
      res.status(400).json({ error: '학기와 전공을 선택해 주세요.' });
      return;
    }

    try {
      const all = await getCourses(term, major);
      const filtered = all
        // 대면 시간이 없는 과목(온라인 전용)은 시간표에 넣을 수 없다.
        .filter((c) => c.slots.length > 0)
        .filter((c) => !grade || c.grade === grade || c.grade === '전학년')
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.professor.toLowerCase().includes(q));

      // 학년 선택지는 필터 전 목록에서 뽑아 준다.
      const grades = [...new Set(all.map((c) => c.grade).filter(Boolean))].sort();

      res.json({ courses: filtered, grades, total: all.length });
    } catch (err) {
      console.error('[courses] 강의 조회 실패:', err);
      res.status(503).json({ error: '학교 강의시간표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  }),
);
