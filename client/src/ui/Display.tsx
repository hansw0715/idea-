import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Choice } from './Form';

/** KRDS 글자 크기: 90 / 100 / 110 / 130 / 150% */
export const ZOOM_OPTIONS = [
  { value: 0.9, label: '90%', desc: '작게' },
  { value: 1, label: '100%', desc: '기본' },
  { value: 1.1, label: '110%', desc: '조금 크게' },
  { value: 1.3, label: '130%', desc: '크게' },
  { value: 1.5, label: '150%', desc: '가장 크게' },
] as const;

export type Contrast = 'normal' | 'high';

interface DisplayState {
  zoom: number;
  contrast: Contrast;
}

interface DisplayApi extends DisplayState {
  openSettings: () => void;
}

const STORAGE_KEY = 'sangsang-booke-display';
const DEFAULTS: DisplayState = { zoom: 1, contrast: 'normal' };

function read(): DisplayState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DisplayState>;
      const zoom = ZOOM_OPTIONS.some((o) => o.value === parsed.zoom) ? (parsed.zoom as number) : 1;
      const contrast: Contrast = parsed.contrast === 'high' ? 'high' : 'normal';
      return { zoom, contrast };
    }
  } catch {
    /* 저장소가 막힌 환경에서는 기본값으로 시작 */
  }
  // 저장된 선택이 없으면 OS 의 "대비 높이기" 설정을 따른다.
  const prefersMore =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-contrast: more)').matches;
  return { ...DEFAULTS, contrast: prefersMore ? 'high' : 'normal' };
}

function apply(state: DisplayState) {
  const root = document.documentElement;
  root.style.setProperty('--zoom', String(state.zoom));
  if (state.contrast === 'high') root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
}

// 첫 화면이 그려지기 전에 적용해 크기가 튀지 않게 한다.
if (typeof document !== 'undefined') apply(read());

const DisplayContext = createContext<DisplayApi>({
  ...DEFAULTS,
  openSettings: () => undefined,
});

export function useDisplay(): DisplayApi {
  return useContext(DisplayContext);
}

/** "글자·화면 설정": KRDS 가 모든 화면 헤더에 상시 노출하도록 한 1차 접근성 컨트롤 */
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DisplayState>(read);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apply(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 무시 */
    }
  }, [state]);

  const openSettings = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ ...state, openSettings }), [state, openSettings]);

  return (
    <DisplayContext.Provider value={value}>
      {children}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="글자·화면 설정"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setState(DEFAULTS)}>
              초기화
            </Button>
            <Button onClick={() => setOpen(false)}>적용하기</Button>
          </>
        }
      >
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">글자 크기</legend>
          {ZOOM_OPTIONS.map((o) => (
            <Choice
              key={o.value}
              type="radio"
              name="display-zoom"
              label={`${o.label} · ${o.desc}`}
              checked={state.zoom === o.value}
              onChange={() => setState((s) => ({ ...s, zoom: o.value }))}
            />
          ))}
        </fieldset>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, marginTop: 'var(--sp-8)' }}>
          <legend className="field__label">화면 모드</legend>
          <Choice
            type="radio"
            name="display-contrast"
            label="일반"
            checked={state.contrast === 'normal'}
            onChange={() => setState((s) => ({ ...s, contrast: 'normal' }))}
          />
          <Choice
            type="radio"
            name="display-contrast"
            label="선명한 화면"
            description="글자와 경계선의 대비를 높여 보여 줍니다."
            checked={state.contrast === 'high'}
            onChange={() => setState((s) => ({ ...s, contrast: 'high' }))}
          />
        </fieldset>
      </Sheet>
    </DisplayContext.Provider>
  );
}
