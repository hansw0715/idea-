import { useId } from 'react';
import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from '../../ui';
import '../gathering.css';

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength' | 'value'> & {
  label: string;
  value: string;
  /** 입력 제한이자 "12/200" 글자 수 안내의 분모 */
  maxLength: number;
  required?: boolean;
  help?: ReactNode;
  error?: string | null;
};

/**
 * 여러 줄 입력 (밑줄형). `ui` 의 TextField 는 한 줄 입력만 있어서 라운지 시트(신청 한마디·소개·신고 내용)가 같이 쓰는 조각으로 둔다.
 * 라벨·도움말·오류를 aria 로 잇는 방식은 TextField 와 같다.
 */
export default function TextAreaField({
  label,
  value,
  maxLength,
  required,
  help,
  error,
  id: idProp,
  className,
  rows = 3,
  ...rest
}: TextAreaFieldProps) {
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
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
      <textarea
        id={id}
        className={`input lounge-gath-textarea${className ? ` ${className}` : ''}`}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      <div className="lounge-gath-fieldmeta">
        <div className="grow">
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
        </div>
        {/* 화면 낭독기에는 읽지 않는다(입력할 때마다 읽히면 방해). 제한은 maxLength 가 지킨다. */}
        <p className="lounge-gath-count" aria-hidden="true">
          {value.length}/{maxLength}
        </p>
      </div>
    </div>
  );
}
