import * as Twoslash from 'fumadocs-twoslash/ui'
import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import type { ComponentProps } from 'react'
import { Callout } from './callout'
import { Card, Cards } from './cards'
import { CodeBlock } from './code-block'
import { Example } from './example'
import { FlowDiagram } from './flow-diagram'
import { createHeading } from './heading'
import { Operation } from './operation'
import { ErrorCategoryTable, OperationTable } from './reference-tables'
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  Tab,
  Tabs,
} from './tabs'
import { TryIt } from './try-it'

function Anchor({ href = '', children, ...props }: ComponentProps<'a'>) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  )
}

function Table(props: ComponentProps<'table'>) {
  return (
    <div className="table-wrap">
      <table {...props} />
    </div>
  )
}

export const baseMdxComponents = {
  a: Anchor,
  h2: createHeading('h2'),
  h3: createHeading('h3'),
  h4: createHeading('h4'),
  h5: createHeading('h5'),
  pre: CodeBlock,
  table: Table,
  Callout,
  Card,
  Cards,
  ErrorCategoryTable,
  Example,
  FlowDiagram,
  Operation,
  OperationTable,
  Tab,
  Tabs,
  TryIt,
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  ...Twoslash,
} satisfies MDXComponents

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...baseMdxComponents, ...components }
}
