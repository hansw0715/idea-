import { describe, expect, it } from 'vitest';
import { findCancelControl, parseMineRaw } from './parse.js';

describe('취소 컨트롤 찾기(고정 fixture)', () => {
  it('주소가 있는 링크', () => {
    expect(findCancelControl('<td><a href="/resve/x/1/artclCancel.do?no=7" class="btn">취소</a></td>')).toEqual({ kind: 'link', href: '/resve/x/1/artclCancel.do?no=7' });
  });
  it('폼', () => {
    const c = findCancelControl('<form action="artclDelete.do" method="post"><input type="hidden" name="no" value="7"><button>신청 취소</button></form>');
    expect(c).toEqual({ kind: 'form', action: 'artclDelete.do', method: 'post', fields: [['no', '7']] });
  });
  it('onclick 스크립트뿐이면 앱이 보내지 않는다', () => {
    expect(findCancelControl('<a href="javascript:void(0)" onclick="fnCancel(7)">취소</a>')).toEqual({ kind: 'script' });
  });
  it('취소 컨트롤이 없으면 null', () => {
    expect(findCancelControl('<td>승인대기</td>')).toBeNull();
  });
  it('행 읽기', () => {
    const html = '<table><tr><td>7</td><td>소모임실</td><td>2026-10-09</td><td>10:00~12:00</td><td>n</td><td>s</td><td>2026-10-08</td><td>승인대기</td><td><a href="/resve/a/b/c.do">취소</a></td></tr></table>';
    const rows = parseMineRaw(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].row.status).toBe('승인대기');
  });
});
