"use client"
import { useCallback, useId } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import type { ErrorKey } from '@/lib/appError'
import { cn } from '@/lib/utils'

// The parts the account forms share (sign-in, sign-up, the recovery pages and the account settings): a labelled field
// with its own error, the message line under a form, and the text of a refused request.

type FieldProps = {
  label: string
  name: string
  type?: 'text' | 'email' | 'password'
  autoComplete: string
  value: string
  onChange: (value: string) => void
  /** The field's problem, shown under it and tied to it (aria-invalid, aria-describedby). */
  error?: string
  hint?: string
  disabled?: boolean
}

export function FormField({ label, name, type = 'text', autoComplete, value, onChange, error, hint, disabled }: FieldProps) {
  const id = useId()
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ')
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} name={name} type={type} autoComplete={autoComplete} value={value} disabled={disabled}
      autoCapitalize={type === 'email' || type === 'password' || name === 'loginId' ? 'none' : undefined} spellCheck={false}
      aria-invalid={error ? true : undefined} aria-describedby={described || undefined}
      onChange={event => onChange(event.target.value)} className="h-10" />
    {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
  </div>
}

/** A form's outcome: an alert for a failure, a status for a success. */
export function FormMessage({ kind, children, className }: { kind: 'error' | 'done', children: React.ReactNode, className?: string }) {
  return kind === 'error'
    ? <p role="alert" className={cn('text-sm text-destructive', className)}>{children}</p>
    : <p role="status" className={cn('text-sm', className)}>{children}</p>
}

/** The text of a refused account request: the server's error key in the reader's language, else fallback. */
export function useApiErrorText() {
  const t = useTranslations('errors')
  return useCallback((reason: unknown, fallback: string) =>
    reason instanceof ApiError && reason.key && t.has(reason.key as ErrorKey) ? t(reason.key as ErrorKey) : fallback, [t])
}
