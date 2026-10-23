import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

/**
 * 화면 글자 크기. 예전 "글자 크기 설정"의 80% 를 기본 크기로 고정했다 (설정 버튼은 없앴다).
 * html 글자 크기 = 62.5% × --zoom 이라 모든 rem 크기가 이 배율을 따른다.
 */
export const BASE_ZOOM = 0.8;

interface DisplayApi {
  zoom: number;
}

/** 예전 설정(글자 크기·화면 모드)이 남긴 저장값과 쿠키 — 더 쓰지 않으니 지운다 */
const OLD_KEYS = [
  'sangsang-booke-display',
  'sangsang-booke-theme',
  'sangsang-booke-theme-choice',
  'sangsang-booke-theme-mode',
];

function apply() {
  const root = document.documentElement;
  root.style.setProperty('--zoom', String(BASE_ZOOM));
  // 예전에 켜 두었던 "선명한 화면"·다크 모드 표시는 지운다
  root.removeAttribute('data-contrast');
  root.removeAttribute('data-theme');
}

// 첫 화면이 그려지기 전에 적용해 크기가 튀지 않게 한다.
if (typeof document !== 'undefined') apply();

const DisplayContext = createContext<DisplayApi>({ zoom: BASE_ZOOM });

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    apply();
    try {
      OLD_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* 저장소가 막힌 환경 — 무시 */
    }
    document.cookie = 'sb-theme=; path=/; max-age=0; samesite=lax; secure';
  }, []);
  return <DisplayContext.Provider value={{ zoom: BASE_ZOOM }}>{children}</DisplayContext.Provider>;
}
