import type { RequestOutcome, SandboxRequest } from '@/sandbox/runtime/protocol'

const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  invoice: 'számla',
  proforma: 'díjbekérő',
  advance: 'előlegszámla',
  draft: 'piszkozat',
  cancellation: 'sztornó',
  modification: 'módosító számla',
  receipt: 'nyugta',
  receipt_cancellation: 'nyugta sztornó',
  dossier: 'dosszié',
  waybill: 'szállítólevél',
  offer: 'árajánlat',
  order_form: 'megrendelő',
}

const PAYMENT_STATUSES: Readonly<Record<string, string>> = {
  paid: 'fizetve',
  outstanding: 'nyitott',
  partially_paid: 'részben fizetve',
  expired: 'lejárt',
  none: 'nincs fizetendő',
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPES[type] ?? type
}

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUSES[status] ?? status
}

export function formatAmount(value: number, currency: string): string {
  const formatter = new Intl.NumberFormat('hu-HU', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'HUF' ? 0 : 2,
  })
  return formatter.format(value)
}

export type StatusTone = 'ok' | 'client-error' | 'server-error' | 'network'

export function statusTone(status: RequestOutcome): StatusTone {
  if (status === 'network' || status === 'timeout') return 'network'
  if (status >= 500) return 'server-error'
  if (status >= 400) return 'client-error'
  return 'ok'
}

export function statusLabel(status: RequestOutcome): string {
  if (status === 'network') return 'hálózati hiba'
  if (status === 'timeout') return 'időtúllépés'
  return String(status)
}

export function requestTarget(request: Pick<SandboxRequest, 'path' | 'query'>): string {
  if (request.query.length === 0) return request.path
  const query = request.query.map(([name, value]) => `${name}=${value}`).join('&')
  return `${request.path}?${query}`
}

export function isWrite(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD'
}

export function defaultOpenRequest(requests: readonly SandboxRequest[]): number | undefined {
  return (requests.findLast((request) => isWrite(request.method)) ?? requests[0])?.id
}
