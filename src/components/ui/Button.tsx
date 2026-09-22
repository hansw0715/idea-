/**
 * 공용 버튼. 페이지에서 버튼 스타일을 직접 쓰지 말고 이걸 쓴다 — 디자인 교체 시 여기만 고치면 된다.
 */
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:opacity-90',
  secondary: 'border border-border bg-surface text-foreground hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-foreground',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';

type StyleProps = { variant?: Variant; size?: Size; block?: boolean };

export const buttonClass = ({ variant = 'primary', size = 'md', block }: StyleProps = {}) =>
  cx(base, VARIANT[variant], SIZE[size], block && 'w-full');

export function Button({
  variant,
  size,
  block,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & StyleProps) {
  return <button type={type} className={cx(buttonClass({ variant, size, block }), className)} {...rest} />;
}

/** 버튼처럼 생긴 링크 */
export function ButtonLink({ variant, size, block, className, ...rest }: ComponentProps<typeof Link> & StyleProps) {
  return <Link className={cx(buttonClass({ variant, size, block }), className)} {...rest} />;
}
