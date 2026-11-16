import type { Metadata } from 'next'
import { SandboxApp } from '@/components/sandbox/sandbox-app'
import examples from '@/generated/examples.json'
import manifest from '@/generated/sandbox-manifest.json'
import { site } from '@/lib/site'
import { findExample } from '@/sandbox/examples/catalog'

export const metadata: Metadata = {
  title: 'Sandbox',
  description:
    'Futtasd a tárca példáit a böngészőben, API kulcs nélkül. A kód egy hamis Billingo ellen fut, és látod a pontosan elküldött JSON-t és a választ.',
  alternates: { canonical: '/sandbox' },
}

const sandboxExamples = examples.flatMap((example) => {
  const meta = findExample(example.slug)
  return meta ? [{ ...meta, code: example.code }] : []
})

export default function SandboxPage() {
  return <SandboxApp examples={sandboxExamples} manifest={manifest} tarcaVersion={site.version} />
}
