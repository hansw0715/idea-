import { describe, expect, it } from 'vitest';
import { parseNoticeList } from './notices.js';
import { findDepartmentBoard } from '../shared/notices/match.js';
import type { DepartmentBoard } from '../shared/notices/types.js';

const LIST_HTML = `
<table><tbody>
  <tr class="notice">
    <td class="td-num"><span class="notice-title">일반공지</span></td>
    <td class="td-title notice alignL">
      <a href="/bbs/hansung/2127/225268/artclView.do" onclick="jf_viewArtcl('hansung', '2127', '225268')">
        <strong>2026학년도 2학기   오찬 안내</strong>
      </a>
    </td>
    <td class="td-write"> 학생복지팀 </td>
    <td class="td-date">2026.10.07</td>
  </tr>
  <tr>
    <td class="td-num">1203</td>
    <td class="td-title alignL">
      <a href="/bbs/hansung/2127/225590/artclView.do">법무법인 현장실습 모집</a>
    </td>
    <td class="td-write">현장실습지원센터</td>
    <td class="td-date">2026.10.22</td>
  </tr>
  <tr><td colspan="5">등록된 글이 없습니다.</td></tr>
</tbody></table>`;

describe('parseNoticeList', () => {
  it('제목·날짜·작성자·원문 주소와 고정 여부를 읽는다', () => {
    expect(parseNoticeList(LIST_HTML, 'hansung', 2127)).toEqual([
      {
        id: 'hansung-2127-225268',
        title: '2026학년도 2학기 오찬 안내',
        date: '2026-10-07',
        writer: '학생복지팀',
        url: 'https://hansung.ac.kr/bbs/hansung/2127/225268/artclView.do',
        pinned: true,
      },
      {
        id: 'hansung-2127-225590',
        title: '법무법인 현장실습 모집',
        date: '2026-10-22',
        writer: '현장실습지원센터',
        url: 'https://hansung.ac.kr/bbs/hansung/2127/225590/artclView.do',
        pinned: false,
      },
    ]);
  });

  it('다른 게시판 링크나 날짜 없는 줄은 건너뛴다', () => {
    expect(parseNoticeList(LIST_HTML, 'hansung', 9999)).toEqual([]);
  });
});

describe('findDepartmentBoard', () => {
  const boards: DepartmentBoard[] = [
    { name: 'AI응용학과', site: 'CreCon', boards: [1943], url: 'u1' },
    { name: '미래모빌리티학과', site: 'CreCon', boards: [1954], url: 'u2' },
    { name: '사회과학부', site: 'SclScn', boards: [1765, 1759], url: 'u3', shared: 'tracks' },
    { name: '국제무역트랙', site: 'SclScn', boards: [1765], url: 'u4' },
    { name: '기계전자공학부', site: 'Engineering', boards: [1551, 1556], url: 'u6', shared: 'tracks' },
    { name: '전자트랙', site: 'Engineering', boards: [1551], url: 'u7' },
    { name: 'AI·소프트웨어학과', site: 'futureplus', boards: [1790], url: 'u5', shared: 'college' },
  ];

  it('이름이 같으면 그 게시판', () => {
    expect(findDepartmentBoard('AI응용학과', boards)?.boards).toEqual([1943]);
  });

  it('띄어쓰기·가운뎃점 차이는 무시한다', () => {
    expect(findDepartmentBoard('미래 모빌리티학과', boards)?.url).toBe('u2');
    expect(findDepartmentBoard('AI소프트웨어학과', boards)?.url).toBe('u5');
  });

  it('소속 글자에 학부와 트랙이 같이 있으면 더 구체적인 트랙', () => {
    expect(findDepartmentBoard('사회과학부 국제무역트랙', boards)?.url).toBe('u4');
    expect(findDepartmentBoard('사회과학부', boards)?.url).toBe('u3');
    expect(findDepartmentBoard('기계전자공학부 전자트랙', boards)?.url).toBe('u7');
  });

  it('모르는 소속이나 빈 값은 null', () => {
    expect(findDepartmentBoard('', boards)).toBeNull();
    expect(findDepartmentBoard('천문학과', boards)).toBeNull();
  });
});
