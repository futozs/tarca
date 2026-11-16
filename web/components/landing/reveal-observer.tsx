'use client'

import { useEffect } from 'react'

const REVEAL_SELECTOR = '.ld-reveal, [data-grow]'
const VISIBLE_SHARE = 0.12

export function RevealObserver() {
  useEffect(() => {
    const targets = document.querySelectorAll(REVEAL_SELECTOR)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const target of targets) target.classList.add('is-in')
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { threshold: VISIBLE_SHARE },
    )
    for (const target of targets) observer.observe(target)
    return () => observer.disconnect()
  }, [])

  return null
}
