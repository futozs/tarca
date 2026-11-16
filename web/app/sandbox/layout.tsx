import type { ReactNode } from 'react'
import { Navbar } from '@/components/site/navbar'
import './sandbox.css'

export default function SandboxLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar wide />
      <main id="tartalom">{children}</main>
    </>
  )
}
