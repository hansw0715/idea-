import { describe, expect, it } from 'vitest';
import { parseSchoolClasses } from './service.js';

const ok = { day: 0, start: '09:00', end: '10:15', subject: '자료구조', section: '1', professor: '김교수', room: '공학관 203' };

describe('parseSchoolClasses (미리보기 수업 저장 본문)', () => {
  it('미리보기에서 받은 모양 그대로면 받는다', () => {
    expect(parseSchoolClasses({ classes: [ok] })).toEqual([ok]);
  });
  it('요일·시각 형식이 틀리면 막는다', () => {
    expect(() => parseSchoolClasses({ classes: [{ ...ok, day: 7 }] })).toThrow();
    expect(() => parseSchoolClasses({ classes: [{ ...ok, start: '9:00' }] })).toThrow();
    expect(() => parseSchoolClasses({ classes: [{ ...ok, end: '24:00' }] })).toThrow();
  });
  it('개수 상한과 배열이 아닌 본문을 막는다', () => {
    expect(() => parseSchoolClasses({ classes: Array.from({ length: 201 }, () => ok) })).toThrow();
    expect(() => parseSchoolClasses({ classes: 'x' })).toThrow();
    expect(() => parseSchoolClasses(null)).toThrow();
  });
});
