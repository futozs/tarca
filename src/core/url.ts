import { camelToSnake } from './case'

export type QueryValue = string | number | boolean | undefined

export type QueryParams = Readonly<Record<string, QueryValue>>

export type PathParams = Readonly<Record<string, string | number>>

export function fillPath(template: string, params: PathParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined || value === '') {
      throw new RangeError(`Hiányzik az útvonal paramétere: ${name} (${template})`)
    }
    return encodeURIComponent(String(value))
  })
}

export function buildQuery(params: QueryParams = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    search.append(camelToSnake(key), String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function joinUrl(baseUrl: string, path: string, query: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}${query}`
}
