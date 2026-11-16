import { siteStructuredData } from '@/lib/structured-data'

export function StructuredData() {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: siteStructuredData() }} />
  )
}
