import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import Icon from './Icon';

interface FieldMeta {
  label: string;
  /** 필수 입력: 라벨 옆 빨간 별표 + aria-required + 스크린리더용 문구 */
  required?: boolean;
  /** 입력 방법·수집 목적 등 보조 설명 */
  help?: ReactNode;
  /** 검증 오류: 무엇이 / 왜 / 어떻게 를 한 문장으로 */
  error?: string | null;
}

function Label({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <label className="field__label" htmlFor={id}>
      {label}
      {required && (
        <>
          <span className="field__req" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> 필수 입력 항목입니다</span>
        </>
      )}
    </label>
  );
}

function Message({ id, help, error }: { id: string; help?: ReactNode; error?: string | null }) {
  return (
    <>
      {help ? (
        <p className="field__help" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );
}

function describedBy(id: string, help?: ReactNode, error?: string | null): string | undefined {
  const ids = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

type TextFieldProps = FieldMeta &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
    size?: 'md' | 'lg';
    /** 입력칸 뒤에 붙는 고정 문구 (예: @hansung.ac.kr) */
    suffix?: ReactNode;
  };

/** 밑줄형 텍스트 입력 (라벨·도움말·오류가 aria 로 연결됨) */
export function TextField({
  label,
  required,
  help,
  error,
  size = 'md',
  suffix,
  className,
  id: idProp,
  ...rest
}: TextFieldProps) {
  const auto = useId();
  const id = idProp ?? auto;
  const input = (
    <input
      id={id}
      className={`input${size === 'lg' ? ' input--lg' : ''}${className ? ` ${className}` : ''}`}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, help, error)}
      {...rest}
    />
  );
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <Label id={id} label={label} required={required} />
      {suffix ? (
        <div className="input-group">
          {input}
          <span className="input-group__suffix">{suffix}</span>
        </div>
      ) : (
        input
      )}
      <Message id={id} help={help} error={error} />
    </div>
  );
}

/** 비밀번호: 보기/숨기기 버튼 제공, 붙여넣기·자동완성 허용 */
export function PasswordField({
  label,
  required,
  help,
  error,
  size = 'md',
  id: idProp,
  ...rest
}: Omit<TextFieldProps, 'type' | 'suffix'>) {
  const auto = useId();
  const id = idProp ?? auto;
  const [shown, setShown] = useState(false);
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <Label id={id} label={label} required={required} />
      <div className="input-group">
        <input
          id={id}
          className={`input${size === 'lg' ? ' input--lg' : ''}`}
          type={shown ? 'text' : 'password'}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, help, error)}
          {...rest}
        />
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-label={shown ? '비밀번호 숨기기' : '비밀번호 보기'}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} className="btn__icon" />
        </button>
      </div>
      <Message id={id} help={help} error={error} />
    </div>
  );
}

type SelectFieldProps = FieldMeta &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'md' | 'lg' };

/** 밑줄형 셀렉트 (네이티브 팝업 사용 — 모바일에서 가장 익숙한 선택 UI) */
export function SelectField({
  label,
  required,
  help,
  error,
  size = 'md',
  children,
  id: idProp,
  className,
  ...rest
}: SelectFieldProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <Label id={id} label={label} required={required} />
      <select
        id={id}
        className={`select${size === 'lg' ? ' select--lg' : ''}${className ? ` ${className}` : ''}`}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        {...rest}
      >
        {children}
      </select>
      <Message id={id} help={help} error={error} />
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  help?: ReactNode;
  /** 라벨과 같은 줄 오른쪽 끝에 놓는 요소 (글자 버튼 등) */
  labelAction?: ReactNode;
}

/** 2~3개 중 하나 고르기 (role=radiogroup, 좌우 방향키 이동) */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  help,
  labelAction,
}: SegmentedProps<T>) {
  const id = useId();
  const labelEl = (
    <span className="field__label" id={`${id}-label`}>
      {label}
    </span>
  );
  return (
    <div className="field">
      {labelAction ? (
        <div className="field__labelrow">
          {labelEl}
          {labelAction}
        </div>
      ) : (
        labelEl
      )}
      <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={value === o.value ? 0 : -1}
            className="segmented__item"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length];
              onChange(next.value);
              (e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement)?.focus();
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {help ? <p className="field__help">{help}</p> : null}
    </div>
  );
}

/** 라디오/체크박스 한 줄 */
export function Choice({
  type,
  label,
  description,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type: 'radio' | 'checkbox';
  label: string;
  description?: string;
}) {
  return (
    <label className="choice">
      <input type={type} {...rest} />
      <span className="choice__text">
        {label}
        {description && <span className="choice__desc">{description}</span>}
      </span>
    </label>
  );
}
