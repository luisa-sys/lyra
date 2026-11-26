'use client';

/**
 * KAN-487 — v0.8 profile editor: labelled text input / textarea with helper
 * text, `{n} / {max}` counter and inline error (spec v0.8 §01–§10; plan §C,
 * §E fields).
 *
 * Accessibility: `<label htmlFor>`; helper, counter and error are wired
 * through `aria-describedby`; `aria-invalid` while there is an error.
 * No `maxLength` (it counts UTF-16 units and truncates silently): over the
 * limit the counter turns red and the free-text "too long" message appears
 * inline, live, before any save. The validator's error for the field
 * (`errors[key]`) wins when the caller passes one.
 */

import { forwardRef, type Ref } from 'react';
import { CharCounter } from './char-counter';
import { describedBy, liveFieldError } from '@/modules/profile/editor/editor-ui-helpers';

export const FIELD_CLASS =
  'w-full px-3 py-2 rounded-lg border bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent disabled:opacity-50 read-only:bg-[var(--color-paper)]';
export const FIELD_BORDER_OK = 'border-[var(--color-border)]';
export const FIELD_BORDER_ERROR = 'border-red-600';
export const LABEL_CLASS = 'block text-sm font-medium text-[var(--color-ink)] mb-1';
export const HELPER_CLASS = 'text-xs text-[var(--color-muted)] mb-1.5 leading-relaxed';
export const ERROR_CLASS = 'text-[13px] text-red-700 mt-1';

interface BaseProps {
  /** Unique DOM id; helper/counter/error ids derive from it. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Character limit (code points). Shows the counter when set. */
  max?: number;
  helper?: string;
  /** The validator's error for this field, if any. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  /**
   * Screen-reader-only text appended to the label, e.g. the question an
   * answer field belongs to (`answerLabelContext`).
   */
  labelContext?: string;
  /** Extra ids for `aria-describedby` (e.g. a row's group label). */
  describedBy?: string;
  className?: string;
  onBlur?: () => void;
}

function FieldShell({
  id,
  label,
  helper,
  required,
  hideLabel,
  labelContext,
  className,
  max,
  value,
  error,
  children,
}: Pick<
  BaseProps,
  'id' | 'label' | 'helper' | 'required' | 'hideLabel' | 'labelContext' | 'className' | 'max' | 'value'
> & {
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : LABEL_CLASS}>
        {label}
        {labelContext && <span className="sr-only">{labelContext}</span>}
        {required && (
          <>
            <span aria-hidden="true" className="text-[var(--color-muted)]"> *</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {helper && (
        <p id={`${id}-help`} className={HELPER_CLASS}>
          {helper}
        </p>
      )}
      {children}
      <div className="flex items-start justify-between gap-3">
        {error ? (
          <p id={`${id}-error`} className={ERROR_CLASS}>
            {error}
          </p>
        ) : (
          <span />
        )}
        {max !== undefined && <CharCounter value={value} max={max} id={`${id}-count`} />}
      </div>
    </div>
  );
}

function fieldWiring(p: BaseProps) {
  const error = liveFieldError(p.value, p.max, p.label, p.error);
  const describedById = describedBy(
    p.describedBy,
    p.helper ? `${p.id}-help` : undefined,
    p.max !== undefined ? `${p.id}-count` : undefined,
    error ? `${p.id}-error` : undefined,
  );
  const className = `${FIELD_CLASS} ${error ? FIELD_BORDER_ERROR : FIELD_BORDER_OK}`;
  return { error, describedById, className };
}

export interface TextFieldProps extends BaseProps {
  type?: 'text' | 'url' | 'search';
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  spellCheck?: boolean;
  /** Rendered inside the shell before the input (e.g. a fixed prefix). */
  prefix?: React.ReactNode;
}

export const TextField = forwardRef(function TextField(props: TextFieldProps, ref: Ref<HTMLInputElement>) {
  const { error, describedById, className } = fieldWiring(props);
  const input = (
    <input
      ref={ref}
      id={props.id}
      type={props.type ?? 'text'}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={props.onBlur}
      placeholder={props.placeholder}
      disabled={props.disabled}
      readOnly={props.readOnly}
      aria-required={props.required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedById}
      inputMode={props.inputMode}
      autoComplete={props.autoComplete}
      spellCheck={props.spellCheck}
      className={className}
    />
  );
  return (
    <FieldShell {...props} error={error}>
      {props.prefix ? (
        <div className="flex items-center gap-2">
          {props.prefix}
          {input}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
});

export interface TextAreaProps extends BaseProps {
  rows?: number;
}

/** Multiline: line breaks are kept (the validator keeps single blank lines). */
export const TextArea = forwardRef(function TextArea(props: TextAreaProps, ref: Ref<HTMLTextAreaElement>) {
  const { error, describedById, className } = fieldWiring(props);
  return (
    <FieldShell {...props} error={error}>
      <textarea
        ref={ref}
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        disabled={props.disabled}
        readOnly={props.readOnly}
        aria-required={props.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        rows={props.rows ?? 3}
        className={`${className} resize-none leading-relaxed`}
      />
    </FieldShell>
  );
});
