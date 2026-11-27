import { cn } from '@/lib/utils'

// The tour's progress as short bars; the label (「ステップ 1 / 3」) is for screen readers.
export default function StepDots({ current, total, label }: { current: number, total: number, label: string }) {
  return <div className="flex items-center gap-1">
    <p className="sr-only">{label}</p>
    {Array.from({ length: total }, (_, index) =>
      <span key={index} aria-hidden="true" className={cn('h-1 w-6 rounded-full transition-colors duration-300 motion-reduce:transition-none', index < current ? 'bg-primary' : 'bg-border')} />)}
  </div>
}
