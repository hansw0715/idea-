import { useId } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import Icon from "./Icon";
import type { IconName } from "./Icon";

type Tone = "info" | "primary" | "success" | "warning" | "danger";

const ALERT_ICON: Record<Tone, IconName> = {
  info: "info",
  primary: "info",
  success: "check-circle",
  warning: "alert",
  danger: "x-circle",
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  /** 재시도 등 다음 행동 버튼 */
  actions?: ReactNode;
  className?: string;
}

/**
 * 안내·성공·주의·오류 패널. 색만으로 의미를 전달하지 않도록 아이콘과 글자를 함께 둔다.
 * danger/warning 은 role="alert"(즉시 읽음), 나머지는 role="status"(차분히 읽음).
 */
export function Alert({
  tone = "info",
  title,
  children,
  actions,
  className,
}: AlertProps) {
  const urgent = tone === "danger" || tone === "warning";
  return (
    <div
      className={`alert${tone === "info" ? "" : ` alert--${tone}`}${className ? ` ${className}` : ""}`}
      role={urgent ? "alert" : "status"}
    >
      <Icon name={ALERT_ICON[tone]} className="alert__icon" />
      <div className="alert__body">
        {title && <div className="alert__title">{title}</div>}
        {children && <div>{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Spinner({
  large = false,
  label,
}: {
  large?: boolean;
  label?: string;
}) {
  return (
    <span
      className={`spinner${large ? " spinner--lg" : ""}`}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** 목록·카드 안에서 데이터를 기다릴 때 (aria-busy 로 스크린 리더에 알림) */
export function LoadingBlock({
  children = "불러오는 중입니다.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading-block" role="status" aria-busy="true">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  /** 다음에 할 수 있는 행동을 안내한다. "데이터가 없습니다"만 쓰지 않는다. */
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} className="empty__icon" />}
      <p className="empty__title">{title}</p>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

type BadgeTone =
  "primary" | "success" | "warning" | "danger" | "info" | "point" | "gray";

export function Badge({
  tone = "gray",
  fill = false,
  children,
  className,
}: {
  tone?: BadgeTone;
  fill?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`badge badge--${tone}${fill ? " badge--fill" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}

interface StepperProps {
  steps: string[];
  /** 현재 단계 (1부터) */
  current: number;
}

/** 단계 표시기: 완료 Success · 현재 Primary · 대기 Gray */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol
      className="stepper"
      aria-label={`진행 단계: 전체 ${steps.length}단계 중 ${current}단계`}
    >
      {steps.map((label, i) => {
        const n = i + 1;
        const state =
          n < current ? "is-done" : n === current ? "is-current" : "";
        return (
          <li
            key={label}
            className={`stepper__step ${state}`}
            aria-current={n === current ? "step" : undefined}
          >
            <span className="stepper__dot">
              {n < current ? <Icon name="check" /> : n}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

interface TabsProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string }[];
  /** 각 탭 패널의 id 접두사 — panelId(value) 규칙: `${idBase}-panel-${value}` */
  idBase?: string;
}

/** 가로 탭 (role=tablist, ←/→ 로 이동). 패널에는 role="tabpanel" aria-labelledby={`${idBase}-tab-${value}`} 를 붙인다. */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
  idBase,
}: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? auto;
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.value === value);
    const next =
      tabs[
        (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
      ];
    onChange(next.value);
    document.getElementById(`${base}-tab-${next.value}`)?.focus();
  }
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={
        {
          "--tabs-count": tabs.length,
          "--tabs-index": Math.max(
            0,
            tabs.findIndex((t) => t.value === value),
          ),
        } as CSSProperties
      }
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          id={`${base}-tab-${t.value}`}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          aria-controls={`${base}-panel-${t.value}`}
          tabIndex={value === t.value ? 0 : -1}
          className="tabs__tab"
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
