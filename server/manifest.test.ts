import { describe, expect, it } from 'vitest';
import { schemeOf } from './manifest.js';

describe('schemeOf (설치 시작 화면 색)', () => {
  it('주소의 ?scheme= 를 먼저 본다 (설치할 때 쿠키 없이 받아도 다크면 다크)', () => {
    expect(schemeOf('dark', undefined)).toBe('dark');
    expect(schemeOf('light', 'dark')).toBe('light');
  });
  it('주소에 모드가 없으면 쿠키를 본다', () => {
    expect(schemeOf(undefined, 'dark')).toBe('dark');
    expect(schemeOf(undefined, undefined)).toBe('light');
  });
  it('이상한 값은 무시한다', () => {
    expect(schemeOf('purple', undefined)).toBe('light');
    expect(schemeOf(['dark'], 'dark')).toBe('dark');
  });
});
