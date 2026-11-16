import type { Metadata } from 'next'
import { ClosingSection } from '@/components/landing/closing-section'
import { tokenizeTs } from '@/components/landing/code-tokens'
import { CompareSection } from '@/components/landing/compare-section'
import { Hero } from '@/components/landing/hero'
import { PaymentsSection } from '@/components/landing/payments-section'
import { RevealObserver } from '@/components/landing/reveal-observer'
import {
  readHeroSnippet,
  runSampleError,
  runSampleIssue,
  runSampleOnce,
  SAMPLE_VENDOR_ID,
} from '@/components/landing/sample'
import { WhyBento } from '@/components/landing/why-bento'
import { OPERATION_COUNT, SPEC_SPLIT, siteDescription } from '@/lib/operations'
import { site } from '@/lib/site'

export const metadata: Metadata = {
  title: { absolute: 'tárca: Billingo npm csomag és API v3 kliens TypeScripthez' },
  description: siteDescription,
  alternates: { canonical: '/' },
}

const COMPARISON_URL = `${site.repo}#miért-tárca`

const NO_SCRIPT_CSS =
  '.landing :is(.ld-reveal,.wd-later,.hero-leaf,.ops-bar i,.cmp-bar i){opacity:1;transform:none}'

export default async function HomePage() {
  const [snippet, issue, once, error] = await Promise.all([
    readHeroSnippet(),
    runSampleIssue(),
    runSampleOnce(),
    runSampleError(),
  ])
  const code = await tokenizeTs(snippet)

  return (
    <div className="landing">
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
      </noscript>
      <RevealObserver />
      <Hero
        version={site.version}
        operationCount={OPERATION_COUNT}
        code={code}
        requests={issue.requests}
        invoice={issue.invoice}
      />
      <WhyBento
        data={{
          operationCount: OPERATION_COUNT,
          split: SPEC_SPLIT,
          packageName: site.packageName,
          version: site.version,
          vendorId: SAMPLE_VENDOR_ID,
          once,
          error,
        }}
      />
      <CompareSection
        total={OPERATION_COUNT}
        undocumented={SPEC_SPLIT.undocumented}
        packageName={site.packageName}
        comparisonUrl={COMPARISON_URL}
      />
      <PaymentsSection />
      <ClosingSection packageName={site.packageName} repo={site.repo} />
    </div>
  )
}
