import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb'
import { findNeighbour } from 'fumadocs-core/page-tree'
import { ArrowUpRight } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/docs/breadcrumbs'
import { PageActions } from '@/components/docs/page-actions'
import { Pagination } from '@/components/docs/pagination'
import { DesktopToc, MobileToc, TocProvider } from '@/components/docs/toc'
import { getMDXComponents } from '@/components/mdx'
import {
  docsPageTitle,
  isDocsIndex,
  markdownUrl,
  OG_IMAGE_SIZE,
  ogImageUrl,
} from '@/lib/docs-links'
import { site } from '@/lib/site'
import { source } from '@/lib/source'

const dateFormatter = new Intl.DateTimeFormat('hu-HU', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Europe/Budapest',
})

export default async function DocsPage(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const tree = source.getPageTree()
  const breadcrumbs = getBreadcrumbItems(page.url, tree, { includePage: true })
  const neighbours = findNeighbour(tree, page.url)
  const MDX = page.data.body
  const toc = page.data.toc.filter((item) => item.depth <= 3)
  const lastModified = page.data.lastModified
  const editUrl = `${site.editBase}/${page.path}`
  const official = page.data.official

  return (
    <TocProvider toc={toc}>
      <div className="mx-auto grid w-full max-w-[72rem] gap-10 px-4 pt-6 pb-20 sm:px-8 xl:grid-cols-[minmax(0,1fr)_var(--toc-width)] xl:gap-14">
        <div className="min-w-0">
          <Breadcrumbs items={breadcrumbs} />
          <header className="mb-8 max-w-[46rem] border-b border-rule pb-6">
            <h1 className="font-display text-[clamp(2rem,1.5rem+1.6vw,2.6rem)] leading-[1.08] font-bold tracking-[-0.025em] text-balance text-ink [font-stretch:112%]">
              {page.data.title}
            </h1>
            {page.data.description && !isDocsIndex(page) ? (
              <p className="mt-4 text-[1.0625rem] leading-relaxed text-pretty text-ink-2">
                {page.data.description}
              </p>
            ) : null}
            {official || lastModified ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8125rem] text-muted">
                {official ? (
                  <a
                    href={official}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-ink underline decoration-transparent underline-offset-[0.2em] transition-colors duration-[var(--dur-micro)] hover:decoration-current"
                  >
                    Billingo leírás
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
                {lastModified ? (
                  <span>
                    Utoljára frissítve:{' '}
                    <time dateTime={new Date(lastModified).toISOString()}>
                      {dateFormatter.format(new Date(lastModified))}
                    </time>
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>
          <MobileToc toc={toc} />
          <article className="docs-prose max-w-[46rem]">
            <MDX components={getMDXComponents()} />
          </article>
          <div className="mt-12 flex max-w-[46rem] flex-wrap items-center justify-between gap-3 border-t border-rule pt-5 text-[0.8125rem] text-muted">
            <a
              href={editUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-blue-ink hover:underline"
            >
              Oldal szerkesztése GitHubon
            </a>
            <a href={markdownUrl(page)} className="font-mono hover:text-ink">
              {markdownUrl(page)}
            </a>
          </div>
          <div className="max-w-[46rem]">
            <Pagination previous={neighbours.previous} next={neighbours.next} />
          </div>
        </div>
        <aside className="hidden xl:block" aria-label="Oldal tartalma">
          <DesktopToc toc={toc}>
            <PageActions markdownUrl={markdownUrl(page)} editUrl={editUrl} officialUrl={official} />
          </DesktopToc>
        </aside>
      </div>
    </TocProvider>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()
  const title = docsPageTitle(page)
  const image = { url: ogImageUrl(page), ...OG_IMAGE_SIZE, alt: title }
  return {
    title,
    description: page.data.description,
    alternates: {
      canonical: page.url,
      types: { 'text/markdown': markdownUrl(page) },
    },
    openGraph: {
      type: 'article',
      locale: 'hu_HU',
      siteName: site.name,
      title,
      description: page.data.description,
      url: page.url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.data.description,
      images: [image.url],
    },
  }
}
