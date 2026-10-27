/**
 * 앱을 열 때의 로딩 화면(index.html 의 #splash)을 걷어 낸다.
 * 너무 빨리 사라지면 깜빡이기만 하니 들어오는 움직임이 끝날 만큼(최소 900ms)은 보여 주고, 서서히 사라진 뒤 지운다.
 * 여러 번 불려도 한 번만 동작한다.
 */
const MIN_VISIBLE_MS = 900;
const FADE_MS = 300;

let done = false;

export function hideSplash(): void {
  if (done) return;
  done = true;
  const el = document.getElementById('splash');
  if (!el) return;
  const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
  window.setTimeout(() => {
    el.classList.add('is-done');
    window.setTimeout(() => el.remove(), FADE_MS);
  }, wait);
}

// 안전장치: 오류 등으로 아무도 부르지 않아도 8초 뒤에는 걷어 낸다 (로딩 화면이 오류 화면을 가리지 않게)
window.setTimeout(hideSplash, 8000);
