import { type NextRequest, NextResponse } from 'next/server'
import { markdownRoutePath } from '@/lib/docs-links'

export function proxy(request: NextRequest) {
  const target = markdownRoutePath(request.nextUrl.pathname)
  if (!target) return NextResponse.next()
  return NextResponse.rewrite(new URL(target, request.url))
}

export const config = {
  matcher: '/docs/:path+.md',
}
