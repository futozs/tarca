import type { ReactNode } from 'react'
import { BILLINGO_OPERATIONS, type BillingoErrorCategory } from 'tarcajs'
import { cn } from '@/lib/cn'
import { METHOD_TONES, SPEC_LABELS } from './spec-presence'

export function withInlineCode(text: string): ReactNode[] {
  return text
    .split('`')
    .map((part, index) => (index % 2 === 1 ? <code key={part}>{part}</code> : part))
}

function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function OperationTable({ pathPrefix }: { pathPrefix?: string }) {
  const rows = Object.entries(BILLINGO_OPERATIONS).filter(
    ([, operation]) => !pathPrefix || operation.path.startsWith(pathPrefix),
  )
  return (
    <Table head={['Kérés', 'Billingo művelet', 'Spec']}>
      {rows.map(([id, operation]) => (
        <tr key={id}>
          <td>
            <span className="flex items-center gap-2 font-mono text-[0.8125rem]">
              <span
                className={cn(
                  'rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.7rem] font-semibold',
                  METHOD_TONES[operation.method],
                )}
              >
                {operation.method}
              </span>
              {operation.path}
            </span>
          </td>
          <td>
            <code>{id}</code>
          </td>
          <td className="whitespace-nowrap text-ink-2">{SPEC_LABELS[operation.spec]}</td>
        </tr>
      ))}
    </Table>
  )
}

interface CategoryRow {
  readonly http: string
  readonly meaning: string
  readonly retryable: string
}

const CATEGORY_ROWS = {
  auth: { http: '401', meaning: 'Hiányzó vagy érvénytelen API kulcs.', retryable: 'nem' },
  nav_unavailable: {
    http: '401, 403',
    meaning:
      'A funkcióhoz élő NAV kapcsolat kell, ami a profilon nincs (például adószám-ellenőrzés a fejlesztői teszt profilon). A kulcs jó.',
    retryable: 'nem',
  },
  subscription: {
    http: '402',
    meaning: 'A Billingo díjcsomag nem engedi a műveletet, vagy lejárt az előfizetés.',
    retryable: 'nem',
  },
  forbidden: {
    http: '403',
    meaning: 'Csak olvasási jogú kulcs, vagy egy másik cég azonosítója.',
    retryable: 'nem',
  },
  not_found: { http: '404', meaning: 'Nincs ilyen erőforrás.', retryable: 'nem' },
  validation: {
    http: '400, 422',
    meaning: 'Hibás kérés. 422-nél a `fieldErrors` mezőnként sorolja fel a hibákat.',
    retryable: 'nem',
  },
  rate_limit: {
    http: '429',
    meaning: 'Túl sok kérés. A `retryAfterMs` a `Retry-After` fejlécből jön, ha a Billingo küldi.',
    retryable: 'igen, GET-nél',
  },
  not_ready: {
    http: '202',
    meaning: 'A PDF még nem készült el. A `documents.pdf()` kivárja.',
    retryable: 'igen',
  },
  server: { http: '5xx', meaning: 'Hiba a Billingo oldalán.', retryable: 'igen, GET-nél' },
  network: {
    http: 'nincs',
    meaning: 'Nem jött válasz. Írásnál előbb nézd meg, létrejött-e a bizonylat.',
    retryable: 'igen, GET-nél',
  },
  timeout: {
    http: 'nincs',
    meaning: 'Lejárt az időkorlát. Írásnál előbb nézd meg, létrejött-e a bizonylat.',
    retryable: 'igen, GET-nél',
  },
  configuration: {
    http: 'nincs',
    meaning: 'Hiányzó kulcs vagy érvénytelen beállítás.',
    retryable: 'nem',
  },
  unexpected_response: {
    http: '2xx',
    meaning:
      'Üres vagy nem JSON törzs, ahol JSON-t vártunk. Írásnál a művelet a Billingónál ettől még megtörténhetett.',
    retryable: 'nem',
  },
  in_progress: {
    http: 'nincs',
    meaning: '`createOnce` zárral: egy másik folyamat éppen ugyanezt a `vendorId`-t állítja ki.',
    retryable: 'nem, később hívd újra',
  },
  store_unavailable: {
    http: 'nincs',
    meaning: '`createOnce` zárral: a zár tárolója nem érhető el, bizonylat nem készült.',
    retryable: 'nem',
  },
} satisfies Record<BillingoErrorCategory, CategoryRow>

export function ErrorCategoryTable() {
  return (
    <Table head={['Kategória', 'HTTP', 'Jelentés', 'Újrapróbálja?']}>
      {Object.entries(CATEGORY_ROWS).map(([category, row]) => (
        <tr key={category} id={`kategoria-${category}`}>
          <td>
            <code>{category}</code>
          </td>
          <td className="tnum whitespace-nowrap">{row.http}</td>
          <td>{withInlineCode(row.meaning)}</td>
          <td className="whitespace-nowrap text-ink-2">{row.retryable}</td>
        </tr>
      ))}
    </Table>
  )
}
