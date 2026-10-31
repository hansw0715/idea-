import type { SVGProps } from 'react';

/**
 * 24px 격자의 선형 아이콘. 장식이면 그대로(aria-hidden), 의미가 있으면 title 을 넘긴다.
 * 색은 currentColor 를 따른다.
 */
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  users:
    'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6 M16 4.9a3.5 3.5 0 0 1 0 6.2 M18.2 14.4c2 .8 3.3 2.6 3.3 5.6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-left': 'M19 12H5 M11 6l-6 6 6 6',
  close: 'M6 6l12 12 M18 6 6 18',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  search: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M16 16l5 5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.01',
  alert: 'M12 3 22 20H2z M12 10v4.5 M12 17.5v.01',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12.5l3 3 5-6',
  'x-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9 9l6 6 M15 9l-6 6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off':
    'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4 M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.2-1 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0',
  'bell-off': 'M18 8a6 6 0 0 0-9.3-5 M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14 M18 13.5V8 M13.7 21a2 2 0 0 1-3.4 0 M3 3l18 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  pin: 'M12 21s7-6.3 7-11.5a7 7 0 0 0-14 0C5 14.7 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4 M4 4v4h4 M4 13a8 8 0 0 0 14.5 4 M20 20v-4h-4',
  logout: 'M10 4H5v16h5 M16 8l4 4-4 4 M20 12H9',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  lounge:
    'M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3 M4 11a2 2 0 0 0-2 2v4h20v-4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1H6v-1a2 2 0 0 0-2-2z M5 17v2 M19 17v2',
  utensils: 'M5 3v5a3 3 0 0 0 6 0V3 M8 11v10 M17 21V3c-2 1.5-3 4-3 7s1 3 3 3',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z',
  message: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  flag: 'M5 21V4 M5 4h12l-2 4 2 4H5',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M5.6 5.6l12.8 12.8',
  thermometer: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 14s1.5 2 4 2 4-2 4-2 M9 9.5v.01 M15 9.5v.01',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  'user-plus': 'M15 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M19 8v6 M22 11h-6',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14',
  chair: 'M7 3h10v8H7z M5 11h14v4H5z M7 15v6 M17 15v6',
} as const;

export type IconName = keyof typeof PATHS | 'text-size';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  title?: string;
}

export default function Icon({ name, title, strokeWidth = 2, ...rest }: IconProps) {
  const labelled = Boolean(title);
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {name === 'text-size' ? (
        <>
          <path d="M3 18 8 6l5 12 M4.8 14h6.4" />
          <path d="M15 18l2.5-6 2.5 6 M15.8 16.2h3.4" strokeWidth={strokeWidth} />
        </>
      ) : (
        PATHS[name].split(' M').map((d, i) => <path key={i} d={i === 0 ? d : `M${d}`} />)
      )}
    </svg>
  );
}
