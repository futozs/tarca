import { Play } from 'lucide-react'
import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { getExample, pickRequests, requestLine, requestText, responseText } from '@/lib/examples'
import { highlightCode } from '@/lib/highlight'
import { CodeBlockTab, CodeBlockTabs, CodeBlockTabsList, CodeBlockTabsTrigger } from './tabs'

export async function Example({
  slug,
  operation,
  title,
}: {
  slug: string
  operation?: string
  title?: string
}) {
  const example = getExample(slug)
  const requests = pickRequests(example.requests, operation)
  const code = await highlightCode(example.code, {
    lang: 'ts',
    title: `${slug}.ts`,
    twoslash: true,
  })
  const sent: ReactNode[] = []
  const answers: ReactNode[] = []
  for (const [position, request] of requests.entries()) {
    const label = `${requests.length > 1 ? `${position + 1}. ` : ''}${request.operation ?? requestLine(request)}`
    sent.push(
      <Fragment key={`keres-${request.id}`}>
        {await highlightCode(requestText(request), { lang: 'http', title: label })}
      </Fragment>,
    )
    answers.push(
      <Fragment key={`valasz-${request.id}`}>
        {
          await highlightCode(responseText(request), {
            lang: 'http',
            title: `${label} · válasz`,
          })
        }
      </Fragment>,
    )
  }
  const output =
    example.output.length > 0
      ? await highlightCode(example.output.map((line) => line.text).join('\n'), {
          lang: 'text',
          title: 'Konzol',
        })
      : null

  return (
    <section className="not-prose my-8" aria-label={title ?? example.title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-ink-2">{example.description}</p>
        <Link
          href={`/sandbox?pelda=${slug}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-rule-strong bg-paper px-3 text-sm font-semibold whitespace-nowrap text-blue-ink transition-colors duration-[var(--dur-micro)] hover:border-blue hover:bg-leaf active:scale-[0.98]"
        >
          <Play className="size-3.5 fill-current" aria-hidden="true" />
          Futtatás a sandboxban
        </Link>
      </div>
      <CodeBlockTabs defaultValue="kod" groupId="tarca-pelda">
        <CodeBlockTabsList>
          <CodeBlockTabsTrigger value="kod">Kód</CodeBlockTabsTrigger>
          {requests.length > 0 ? (
            <CodeBlockTabsTrigger value="keres">Elküldött kérések</CodeBlockTabsTrigger>
          ) : null}
          {requests.length > 0 ? (
            <CodeBlockTabsTrigger value="valasz">Billingo válasz</CodeBlockTabsTrigger>
          ) : null}
          {output ? <CodeBlockTabsTrigger value="konzol">Konzol</CodeBlockTabsTrigger> : null}
        </CodeBlockTabsList>
        <CodeBlockTab value="kod">{code}</CodeBlockTab>
        {requests.length > 0 ? <CodeBlockTab value="keres">{sent}</CodeBlockTab> : null}
        {requests.length > 0 ? <CodeBlockTab value="valasz">{answers}</CodeBlockTab> : null}
        {output ? <CodeBlockTab value="konzol">{output}</CodeBlockTab> : null}
      </CodeBlockTabs>
    </section>
  )
}
