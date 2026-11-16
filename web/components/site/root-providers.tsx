'use client'

import { NextProvider } from 'fumadocs-core/framework/next'
import type { ReactNode } from 'react'
import { SearchProvider } from './search-context'

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <NextProvider>
      <SearchProvider>{children}</SearchProvider>
    </NextProvider>
  )
}
