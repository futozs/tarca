import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { Archivo, JetBrains_Mono, Public_Sans } from 'next/font/google'
import type { ReactNode } from 'react'
import { RootProviders } from '@/components/site/root-providers'
import { StructuredData } from '@/components/site/structured-data'
import { siteDescription } from '@/lib/operations'
import { site } from '@/lib/site'
import './globals.css'

const display = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--ff-display',
  display: 'swap',
})

const sans = Public_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--ff-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--ff-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: 'tárca: Billingo npm csomag TypeScripthez',
    template: '%s · tárca',
  },
  description: siteDescription,
  applicationName: 'tárca',
  keywords: [
    'billingo',
    'billingo npm',
    'billingo npm csomag',
    'billingo api',
    'billingo api v3',
    'billingo typescript',
    'billingo node.js',
    'billingo sdk',
    'tarcajs',
    'számlázás',
    'számla',
    'nyugta',
    'díjbekérő',
    'NAV online számla',
  ],
  authors: [{ name: 'futozs', url: 'https://github.com/futozs' }],
  openGraph: {
    type: 'website',
    locale: 'hu_HU',
    siteName: 'tárca',
    url: '/',
  },
  twitter: { card: 'summary_large_image' },
  alternates: {
    types: { 'text/plain': '/llms.txt' },
  },
}

export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <StructuredData />
        <RootProviders>{children}</RootProviders>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
