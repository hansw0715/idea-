import { describe, expect, it } from 'vitest';
import { adminLoginBase } from './auth.js';

describe('adminLoginBase (admin_아이디 관리자 로그인)', () => {
  it('지정한 관리자 아이디(dedea715·doctor·hansw)만 관리자 모드가 된다', () => {
    expect(adminLoginBase('admin_dedea715')).toBe('dedea715');
    expect(adminLoginBase('admin_doctor')).toBe('doctor');
    expect(adminLoginBase('admin_hansw')).toBe('hansw');
    expect(adminLoginBase('admin_someone')).toBeNull();
    expect(adminLoginBase('doctor')).toBeNull();
  });
});
