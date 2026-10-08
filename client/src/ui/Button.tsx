import type { ComponentPropsWithRef, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'text'
  | 'danger'
  | 'danger-solid'
  | 'icon';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface ClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  border?: boolean;
}

/** <Link>·<a> 를 버튼 모양으로 그릴 때: className={btnClass({ variant: 'secondary' })} */
export function btnClass(
  { variant = 'primary', size = 'md', block = false, border = false }: ClassOptions = {},
  extra?: string,
): string {
  return [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    border && 'btn--icon-border',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ComponentPropsWithRef<'button'>, ClassOptions {
  /** 처리 중: 비활성 + 스피너. 문구는 "처리 중…"처럼 호출하는 쪽에서 바꾼다. */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * KRDS 버튼. 기본 type 은 "button" (폼 안에서 실수로 제출되지 않게). 제출은 type="submit" 으로 명시한다.
 * 한 화면에 variant="primary" 는 하나만 둔다.
 */
export function Button({
  variant,
  size,
  block,
  border,
  loading = false,
  className,
  type = 'button',
  disabled,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={btnClass({ variant, size, block, border }, className)}
      disabled={disabled}
      {...rest}
      // 처리 중에는 disabled 대신 aria-disabled 로 막아 포커스가 버튼에 남게 한다.
      aria-disabled={loading ? true : rest['aria-disabled']}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
