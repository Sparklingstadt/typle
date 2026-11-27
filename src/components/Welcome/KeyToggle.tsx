"use client"
import { cn } from '@/lib/utils'

type Props = {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  sub?: string
  mono?: boolean
  accessibleName: string
  disabled?: boolean
  shortcut?: string
}

// A checkbox drawn as a keycap: Space toggles it, so Enter stays free for the tour's main button.
export default function KeyToggle({ checked, onChange, label, sub, mono = false, accessibleName, disabled = false, shortcut }: Props) {
  return <label className={cn('relative inline-flex', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
    <input type="checkbox" aria-label={accessibleName} checked={checked} disabled={disabled}
      onChange={event => onChange(event.target.checked)} className="peer absolute inset-0 size-full cursor-[inherit] opacity-0" />
    <span aria-hidden="true" className={cn(
      'inline-flex min-h-10 flex-col items-center justify-center rounded-lg border border-b-[3px] px-3 py-1 text-sm leading-tight font-medium transition-[transform,background-color,border-color] duration-150',
      'peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 motion-reduce:transition-none',
      checked
        ? 'translate-y-px border-primary border-b-primary/70 bg-primary text-primary-foreground'
        : 'border-border border-b-foreground/20 bg-card text-foreground peer-hover:bg-muted',
    )}>
      <span className={cn('flex items-center gap-1.5', mono && 'font-mono')}>
        {shortcut && <span className={cn('text-xs', checked ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{shortcut}</span>}
        {label}
      </span>
      {sub && <span className={cn('text-[11px] font-normal', checked ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{sub}</span>}
    </span>
  </label>
}
