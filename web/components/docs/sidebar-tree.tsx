'use client'

import type * as PageTree from 'fumadocs-core/page-tree'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { cn } from '@/lib/cn'
import {
  sidebarItemActiveClass,
  sidebarItemClass,
  sidebarItemIdleClass,
  sidebarSeparatorClass,
} from './sidebar-styles'

function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function folderContains(folder: PageTree.Folder, pathname: string): boolean {
  if (folder.index && normalize(folder.index.url) === pathname) return true
  return folder.children.some((child) => {
    if (child.type === 'page') return normalize(child.url) === pathname
    if (child.type === 'folder') return folderContains(child, pathname)
    return false
  })
}

export function SidebarTree({
  tree,
  onNavigate,
}: {
  tree: PageTree.Root
  onNavigate?: () => void
}) {
  const pathname = normalize(usePathname())
  return (
    <nav aria-label="Dokumentáció">
      <ul className="flex flex-col gap-0.5">
        {tree.children.map((node) => (
          <SidebarNode
            key={node.$id ?? String(node.name)}
            node={node}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  )
}

function SidebarNode({
  node,
  pathname,
  onNavigate,
}: {
  node: PageTree.Node
  pathname: string
  onNavigate: (() => void) | undefined
}) {
  if (node.type === 'separator') {
    return <li className={sidebarSeparatorClass}>{node.name}</li>
  }
  if (node.type === 'page') {
    return (
      <li>
        <SidebarLink
          href={node.url}
          active={normalize(node.url) === pathname}
          external={node.external}
          onNavigate={onNavigate}
        >
          {node.name}
        </SidebarLink>
      </li>
    )
  }
  return <SidebarFolder folder={node} pathname={pathname} onNavigate={onNavigate} />
}

const itemClass = sidebarItemClass

function SidebarLink({
  href,
  active,
  external,
  onNavigate,
  children,
}: {
  href: string
  active: boolean
  external: boolean | undefined
  onNavigate: (() => void) | undefined
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className={cn(itemClass, active ? sidebarItemActiveClass : sidebarItemIdleClass)}
    >
      {children}
    </Link>
  )
}

function SidebarFolder({
  folder,
  pathname,
  onNavigate,
}: {
  folder: PageTree.Folder
  pathname: string
  onNavigate: (() => void) | undefined
}) {
  const containsActive = folderContains(folder, pathname)
  const [open, setOpen] = useState(containsActive || folder.defaultOpen === true)
  const panelId = useId()

  useEffect(() => {
    if (containsActive) setOpen(true)
  }, [containsActive])

  const indexActive = folder.index ? normalize(folder.index.url) === pathname : false
  const indexUrl = folder.index?.url
  const children = folder.children.filter(
    (child) => !(child.type === 'page' && child.url === indexUrl),
  )
  const chevron = (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        'size-4 shrink-0 text-muted transition-transform duration-[var(--dur-short)] ease-out',
        open && 'rotate-90',
      )}
    />
  )

  if (folder.index && children.length === 0) {
    return (
      <li>
        <Link
          href={folder.index.url}
          onClick={onNavigate}
          aria-current={indexActive ? 'page' : undefined}
          className={cn(itemClass, indexActive ? sidebarItemActiveClass : sidebarItemIdleClass)}
        >
          {folder.name}
        </Link>
      </li>
    )
  }

  return (
    <li>
      {folder.index ? (
        <div
          className={cn(
            'flex items-stretch rounded-[var(--radius-md)] transition-colors duration-[var(--dur-micro)]',
            indexActive ? 'bg-leaf' : 'hover:bg-leaf',
          )}
        >
          <Link
            href={folder.index.url}
            onClick={() => {
              setOpen(true)
              onNavigate?.()
            }}
            aria-current={indexActive ? 'page' : undefined}
            className={cn(
              itemClass,
              'flex-1 hover:bg-transparent',
              indexActive
                ? 'font-semibold text-blue-ink'
                : containsActive
                  ? 'text-ink'
                  : 'text-ink-2',
            )}
          >
            {folder.name}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={
              open ? `${String(folder.name)} összecsukása` : `${String(folder.name)} kinyitása`
            }
            className="inline-flex w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] hover:bg-leaf-2"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            itemClass,
            'justify-between gap-2 hover:bg-leaf',
            containsActive ? 'text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          <span>{folder.name}</span>
          {chevron}
        </button>
      )}
      <div id={panelId} hidden={!open}>
        <ul className="flex flex-col gap-0.5 pt-0.5 pl-3">
          {children.map((child) => (
            <SidebarNode
              key={child.$id ?? String(child.name)}
              node={child}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </li>
  )
}
