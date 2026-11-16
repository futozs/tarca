import { useId } from 'react'
import { cn } from '@/lib/cn'
import { LogoArt } from '@/lib/logo-art'

export function LogoMark({ className }: { className?: string }) {
  const id = useId().replaceAll(':', '')
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={cn('size-[30px] shrink-0', className)}>
      <LogoArt id={id} />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-display text-[1.25rem] leading-none font-[750] tracking-[-0.02em] text-ink [font-stretch:112%]">
        tárca
      </span>
    </span>
  )
}
