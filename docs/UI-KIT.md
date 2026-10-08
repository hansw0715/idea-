# 상상Book-E 모바일 UI 키트 (KRDS)

원본 디자인 규약은 루트의 [`DESIGN.md`](../DESIGN.md) (KRDS 정부 디자인 시스템). 이 문서는 그것을 **이 프로젝트에서 어떻게 쓰는지**만 적는다.
충돌하면 순서는 `DESIGN.md` 의 "Explicit user selections" → 이 문서 → KRDS 일반 서술이다.

## 0. 사용자가 못 박은 선택 (DESIGN.md)

| 항목 | 값 | 구현 |
|---|---|---|
| Primary | `#6366f1` | `--primary-50` (액션 색). 글자로 쓸 땐 `--primary-60` |
| 라운드 | `4px` | `--r`. 버튼·입력·카드·배지·시트 전부. 원형/필터 칩만 `--r-pill` |
| 입력 | underline | `.input` `.select` 는 밑줄형. 상자형 입력 금지 |
| 내비 | solid | 헤더·탭바는 불투명 흰 면. 반투명·blur·그림자 금지 |
| 밀도 | compact | 거터 16px, 카드 패딩 16px, 섹션 간격 24px |

## 1. 규칙 요약 (어기면 리뷰에서 반려)

1. **색은 토큰만.** `var(--c-*)`, `var(--primary-*)`, `var(--gray-*)` 등. CSS/TSX 에 `#` 헥스·`rgb()` 를 직접 쓰지 않는다. (`styles/tokens.css` 만 예외)
2. **크기는 rem.** `html` 이 `62.5% × 사용자 확대배율` 이라 `1rem = 10px`. 글자·간격·높이 모두 rem (`1.7rem` = 17px). px 는 `1px` 보더·`-webkit-` 미세 보정에만. 그래야 "글자·화면 설정" 150% 에서 같이 커진다.
3. **글자 두께는 400/700 두 가지만.** 500/600 금지. 본문 `var(--fs-md)`(17px), 보조 `--fs-sm`(15px), 메타 `--fs-xs`(13px). 그보다 작은 글자 금지.
4. **한 화면에 Primary 버튼은 하나.** 나머지는 Secondary/Tertiary/Text.
5. **색만으로 의미를 전달하지 않는다.** 상태는 글자(+아이콘)와 함께. 선택 상태는 `aria-pressed`/`aria-checked`/`aria-selected`.
6. **그림자 금지** (모달·시트·토스트 제외). 영역 구분은 1px 보더.
7. **모션 400ms 이하, ease-in-out/ease/linear.** 스프링·바운스 금지. `--t-base` `--t-fade` 변수를 쓰면 `prefers-reduced-motion` 에서 자동으로 0.
8. **터치 대상 최소 44px** (`--touch`). 보통은 버튼 md(48)·sm(40, 한 줄에 여럿 둘 때만)·목록 행 56.
9. **입력 글자는 16px 이상** (iOS 확대 방지 — `.input` 이 이미 처리).
10. **가로 스크롤 금지.** 360px 폭에서 `document.documentElement.scrollWidth <= clientWidth`. 표/격자만 자기 컨테이너 안에서 스크롤 허용.
11. **포커스 링은 건드리지 않는다.** 전역 `:focus-visible` 이 처리. `outline: none` 을 추가하려면 대체 표시 필수.
12. **하단 여백.** 탭바가 있는 화면은 `.app-main` 이 이미 아래 여백을 가진다. 화면 하단에 붙는 액션은 `.sticky-actions`.

## 2. 문장 규칙 (KRDS §6)

- 정중한 `-합니다` / `-해 주세요`. 감탄·마케팅 문구("놀라운", "혁신적인", "최고의") 금지. 느낌표 금지.
- 화면 제목은 **명사형 한 줄** ("내 시간표"), 버튼은 **동사+기** ("만들기", "참가하기", "예약하기", "저장하기").
- **빈 상태**: "아직 ~가 없습니다." + 다음 행동(버튼 또는 안내). "데이터가 없습니다" 단독 금지.
- **오류**: 무엇이 / 왜 / 어떻게. 예) "회의 코드를 찾지 못했습니다. 코드가 맞지 않습니다. 숫자 4자리를 다시 확인해 주세요." 서버가 준 `err.message` 는 그대로 보여 주되, 앞에 상황 한 줄을 붙일 수 있다.
- **성공**: 과거 종결형 한 문장 ("회의를 만들었습니다."). 가벼운 확인은 `toast`, 다음 행동이 필요한 결과는 화면 안 `Alert`.
- "잘 모르시겠다면", "고객님께서는 ~해 주시기 바랍니다", "Oops" 류 금지. 어려운 행정 한자어 대신 쉬운 말.
- 필수 입력은 `required` 로 표시(별표 + 스크린리더 문구). 입력 이유가 애매하면 `help` 에 수집 목적을 쓴다.

## 3. 화면 뼈대

```tsx
import { AppHeader } from '../shell/Shell';

// 탭 루트 화면 (홈·시간표·회의·내 정보): 서비스 이름 헤더 + 화면 제목
<>
  <AppHeader />
  <main id="main" className="app-main">
    <div className="page-head">
      <h1 className="page-title">내 시간표</h1>
      <p className="page-lead">시간표를 확인하고 일정을 추가합니다.</p>
    </div>
    <section className="section"> … </section>
  </main>
</>

// 상세 화면: 뒤로가기 + 제목(이 제목이 h1). 본문에 h1 을 또 두지 않는다.
<>
  <AppHeader title={detail.name} backTo="/meetings" actions={<button …/>} />
  <main id="main" className="app-main"> … </main>
</>
```

- 로그인·가입은 탭바 없이 같은 프레임. `<AppHeader />` 를 그대로 쓴다.
- 전체 화면 단계 흐름은 `useHideTabBar()` 로 탭바를 숨긴다 (`../shell/Shell`).
- 프레임은 480px 컬럼 (넓은 화면에서는 가운데 정렬). 360px 부터 대응.

## 4. React 컴포넌트 (`import { … } from '../ui'`)

| 컴포넌트 | 용도 |
|---|---|
| `Button` | `variant`: primary / secondary / tertiary / text / danger / danger-solid / icon. `size`: xs(32) sm(40) md(48,기본) lg(56) xl(64). `block`, `loading`(처리 중 스피너+비활성). **기본 `type="button"`**, 제출은 `type="submit"` |
| `btnClass({variant,size,block})` | `<Link>`·`<a>` 를 버튼처럼: `className={btnClass({variant:'secondary'})}` |
| `TextField` | 밑줄 입력. `label` `required` `help` `error` `suffix` `size="lg"`. 나머지는 input 속성 그대로 |
| `PasswordField` | 비밀번호 + 보기/숨기기 |
| `SelectField` | 밑줄 셀렉트(네이티브). 자식으로 `<option>` |
| `Segmented` | 2~3개 중 하나 (매주/그 날만) |
| `Choice` | 라디오/체크박스 한 줄 |
| `Alert` | `tone`: info/primary/success/warning/danger, `title`, `actions`. danger·warning 은 `role=alert` |
| `LoadingBlock` / `Spinner` | 데이터 대기 (aria-busy) |
| `EmptyState` | `title` + `description` + `action` + 선택적 `icon` |
| `Badge` | `tone`: primary/success/warning/danger/info/point/gray (+`fill`) |
| `Stepper` | `steps={['시간','날짜','시설','확인']} current={2}` |
| `Tabs` | 가로 탭(키보드 ←/→). 패널에 `role="tabpanel" id={`${idBase}-panel-${v}`} aria-labelledby={`${idBase}-tab-${v}`}` |
| `Sheet` | 바텀 시트. `open` `onClose` `title` `footer` `full`(전체 화면). 폼은 시트 안에서 `<form id="x">` + footer 의 `<Button type="submit" form="x">` |
| `useConfirm()` | `const ok = await confirm({ title, message, tone:'danger', confirmLabel, run: async () => api.del(..) })`. `run` 을 주면 응답까지 다이얼로그 유지 + 실패 시 안에 오류 표시 |
| `useToast()` | `toast('복사했습니다.')` — 가벼운 확인용 (4초). `{action:{label:'되돌리기', onClick}}` 가능 |
| `Icon` | `<Icon name="chevron-right" className="list__chev" />` 이름: home calendar users user chevron-left/right/down/up arrow-left close plus minus check copy external search trash info alert check-circle x-circle eye eye-off clock pin refresh logout edit text-size |

## 5. 자주 쓰는 CSS 클래스 (`styles/components.css`, `styles/base.css`)

- 레이아웃: `.page-head` `.page-title` `.page-lead` `.section` `.section__head` `.section__title` `.section__sub` `.stack`(세로 12px) `.stack-sm` `.stack-lg` `.row` `.row-wrap` `.row-between` `.grow` `.truncate` `.sticky-actions`
- 카드/목록: `.card` `.card--flat` `.card--list` `.card__title` / `.list` `.list__item`(`--link` 로 통째 탭) `.list__body` `.list__main` `.list__sub` `.list__chev` / `.kv` `.kv__key` `.kv__val`
- 폼: `.field` `.field__label` `.field__help` `.field__error` `.input` `.select` `.input-group` `.form-row`(좁으면 한 열) `.form-actions`
- 표시: `.badge .badge--success|warning|danger|info|point|gray|primary` `.code-chip`(숫자 식별자) `.tag-group` `.tag`(`aria-pressed`) `.tag__dot`
- 텍스트: `.text-sub` `.text-muted` `.text-danger` `.text-sm` `.text-xs` `.bold` `.tabular`

페이지 전용 스타일은 **자기 페이지의 css 파일**(예: `pages/home.css`)에 쓰고 해당 tsx 에서 import 한다. 클래스 이름은 `home-…` 처럼 페이지 접두사를 붙여 충돌을 막는다.
공통 파일(`styles/*`, `ui/*`, `shell/*`, `App.tsx`)은 건드리지 않는다. 필요한 변경이 있으면 보고서의 `foundationRequests` 에 적는다.

## 6. 상태 화면 패턴 (KRDS §4)

- **로딩**: 목록·카드 자리에 `LoadingBlock`. 화면 전체를 비우고 스피너만 두지 않는다 (제목은 먼저 보인다).
- **빈 상태**: `EmptyState` (제목 + 다음 행동).
- **필드 오류**: `TextField error="…"` — 첫 오류 입력으로 포커스 이동. 폼은 `noValidate` + 직접 검증 + 오류 문장.
- **제출 중**: Primary `loading` + 문구 "처리 중…" 처럼 변경, 중복 제출 방지.
- **제출 실패**: 폼 위 `Alert tone="danger"`, 입력값 보존.
- **서버·네트워크 오류**: `api.ts` 가 `ApiError(0, …)` 를 던진다. 해당 영역에 `Alert tone="danger"` + 다시 시도 버튼.
- **파괴적 동작**(삭제·나가기·탈퇴·예약 취소): 반드시 `useConfirm` — 되돌릴 수 없는 결과를 문장으로 적고 취소가 초기 포커스.

## 7. 검증 도구

개발 서버는 이미 떠 있다 (클라이언트 `http://localhost:5273`, API `:3101`). 시연 계정 `admin1@hansung.ac.kr`, `admin2@…`, `admin3@…` (비밀번호 `Test1234!`). 시연 데이터(시간표·회의 "캡스톤 디자인 팀"·예약 1건) 이미 입력됨.

```bash
# 타입 검사 (남의 파일의 일시적 오류는 잠시 뒤 다시)
node_modules/.bin/tsc -p client/tsconfig.json
# 화면 캡처 (모바일 390×844, 터치). 경로는 앞의 / 없이: home, timetable, meetings, meetings/1, account, login
node scripts/shot.mjs timetable my-timetable --user=admin1 --full
node scripts/shot.mjs account acc-150 --zoom=1.5            # 글자 150%
node scripts/shot.mjs account acc-hc --contrast=high         # 선명한 화면
node scripts/shot.mjs login login-360 --user=none --width=360 --height=740
```

캡처는 `shots/` 에 저장되고 `Read` 도구로 볼 수 있다. 직접 시나리오를 짤 땐 `scripts/lib.mjs` 의 `launch()`(모바일 에뮬레이션) `login(page,'admin1')` `shot()` `horizontalOverflow()` 를 쓴다. Git Bash 에서 `/` 로 시작하는 인자는 경로로 오인되어 바뀌므로 `MSYS_NO_PATHCONV=1` 을 붙이거나 위처럼 `/` 없이 쓴다.

처음 로드 때 `/api/auth/me` 401 콘솔 오류 2개는 로그인 전 확인 호출이라 정상이다.
