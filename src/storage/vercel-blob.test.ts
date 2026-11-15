import { describe, expect, test } from 'vitest'
import { vercelBlobStorage } from './vercel-blob'

const FAKE_PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n%tarca teszt\n%%EOF\n')

type PutBody = string | Blob | ArrayBuffer | ReadableStream | File

interface PutCommandOptions {
  access: 'public' | 'private'
  addRandomSuffix?: boolean
  allowOverwrite?: boolean
  contentType?: string
  cacheControlMaxAge?: number
  token?: string
  abortSignal?: AbortSignal
}

interface PutBlobResult {
  url: string
  downloadUrl: string
  pathname: string
  contentType: string
  contentDisposition: string
}

function fakeVercelBlob() {
  const calls: unknown[][] = []
  const put = async (
    pathname: string,
    body: PutBody,
    options: PutCommandOptions,
  ): Promise<PutBlobResult> => {
    calls.push(['put', pathname, body, options])
    return {
      url: `https://store.public.blob.vercel-storage.com/${pathname}`,
      downloadUrl: `https://store.public.blob.vercel-storage.com/${pathname}?download=1`,
      pathname,
      contentType: options.contentType ?? '',
      contentDisposition: 'inline',
    }
  }
  const del = async (
    urlOrPathname: string[] | string,
    options?: { access?: 'public' | 'private'; token?: string },
  ): Promise<void> => {
    calls.push(['del', urlOrPathname, options])
  }
  const head = async (
    urlOrPathname: string,
    options?: { access?: 'public' | 'private'; token?: string },
  ) => {
    calls.push(['head', urlOrPathname, options])
    return { url: `https://store.public.blob.vercel-storage.com/${urlOrPathname}`, size: 1 }
  }
  return { put, del, head, calls }
}

describe('vercelBlobStorage', () => {
  test('put(pathname, Blob, opciók) a helyes opciókkal, felülírás engedve', async () => {
    const blob = fakeVercelBlob()
    const storage = vercelBlobStorage({
      put: blob.put,
      access: 'private',
      token: 'vercel_blob_rw_x',
      prefix: 'szamlak',
      cacheControlMaxAge: 60,
    })

    const stored = await storage.put('E-1.pdf', FAKE_PDF_BYTES, { contentType: 'application/pdf' })

    const [, pathname, body, options] = blob.calls[0] ?? []
    expect(pathname).toBe('szamlak/E-1.pdf')
    expect(body).toBeInstanceOf(Blob)
    expect(new Uint8Array(await (body as Blob).arrayBuffer())).toEqual(FAKE_PDF_BYTES)
    expect((body as Blob).type).toBe('application/pdf')
    expect(options).toEqual({
      access: 'private',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: 'vercel_blob_rw_x',
      cacheControlMaxAge: 60,
    })
    expect(stored).toEqual({
      key: 'E-1.pdf',
      url: undefined,
      size: FAKE_PDF_BYTES.byteLength,
      contentType: 'application/pdf',
    })
  })

  test('publikus tárolónál a put a Vercel Blob URL-jét adja vissza', async () => {
    const blob = fakeVercelBlob()
    const storage = vercelBlobStorage({ put: blob.put, access: 'public' })

    const stored = await storage.put('E-1.pdf', FAKE_PDF_BYTES, { contentType: 'application/pdf' })

    expect(stored.url).toBe('https://store.public.blob.vercel-storage.com/E-1.pdf')
  })

  test('privát tárolóból nem ad olvashatatlan URL-t', async () => {
    const blob = fakeVercelBlob()
    const storage = vercelBlobStorage({ ...blob, access: 'private' })

    await expect(storage.getUrl?.('a.pdf')).rejects.toMatchObject({
      name: 'StorageError',
      operation: 'getUrl',
      message: expect.stringContaining('presignUrl'),
    })
    expect(blob.calls).toEqual([])
  })

  test('token nélkül nem ad át token mezőt, allowOverwrite kikapcsolható', async () => {
    const blob = fakeVercelBlob()
    const storage = vercelBlobStorage({ put: blob.put, access: 'public', allowOverwrite: false })

    await storage.put('a.pdf', FAKE_PDF_BYTES, { contentType: 'application/pdf' })

    expect(blob.calls[0]?.[3]).toEqual({
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  })

  test('delete és getUrl a del/head függvénnyel, tokennel', async () => {
    const blob = fakeVercelBlob()
    const storage = vercelBlobStorage({ ...blob, access: 'public', token: 't' })

    await storage.delete?.('a.pdf')
    const url = await storage.getUrl?.('a.pdf')

    expect(blob.calls).toEqual([
      ['del', 'a.pdf', { access: 'public', token: 't' }],
      ['head', 'a.pdf', { access: 'public', token: 't' }],
    ])
    expect(url).toBe('https://store.public.blob.vercel-storage.com/a.pdf')
    await expect(storage.getUrl?.('a.pdf', { expiresInSeconds: 60 })).rejects.toThrow('aláírt')
  })

  test('hiányzó del/head függvény és SDK hiba StorageError', async () => {
    const storage = vercelBlobStorage({
      put: () => Promise.reject(new Error('BlobStoreSuspendedError')),
      access: 'public',
    })

    await expect(storage.delete?.('a.pdf')).rejects.toThrow('del függvényét')
    await expect(storage.getUrl?.('a.pdf')).rejects.toThrow('head függvényét')
    await expect(
      storage.put('a.pdf', FAKE_PDF_BYTES, { contentType: 'application/pdf' }),
    ).rejects.toMatchObject({
      name: 'StorageError',
      message: 'Vercel Blob hiba (put): BlobStoreSuspendedError',
    })
  })
})
