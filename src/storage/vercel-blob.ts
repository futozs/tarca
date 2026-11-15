import { guardStorageCall, type StorageError, type StorageOperation, storageError } from './errors'
import { normalizePrefix, resolveKey, toArrayBuffer, unsupportedSignedUrl } from './shared'
import type { StorageAdapter, StoragePutOptions, StoredFile } from './types'

export type VercelBlobAccess = 'public' | 'private'

export interface VercelBlobPutOptions {
  readonly access: VercelBlobAccess
  readonly contentType: string
  readonly addRandomSuffix: boolean
  readonly allowOverwrite: boolean
  readonly token?: string
  readonly cacheControlMaxAge?: number
}

export interface VercelBlobCommandOptions {
  readonly access: VercelBlobAccess
  readonly token?: string
}

export interface VercelBlobPutResult {
  readonly url: string
  readonly pathname: string
}

export interface VercelBlobHeadResult {
  readonly url: string
}

export interface VercelBlobFunctions {
  put(pathname: string, body: Blob, options: VercelBlobPutOptions): Promise<VercelBlobPutResult>
  del?(urlOrPathname: string, options?: VercelBlobCommandOptions): Promise<void>
  head?(urlOrPathname: string, options?: VercelBlobCommandOptions): Promise<VercelBlobHeadResult>
}

export interface VercelBlobStorageOptions extends VercelBlobFunctions {
  readonly access: VercelBlobAccess
  readonly token?: string | undefined
  readonly prefix?: string | undefined
  readonly allowOverwrite?: boolean | undefined
  readonly cacheControlMaxAge?: number | undefined
}

function missingFunction(name: string, key: string, operation: StorageOperation): StorageError {
  return storageError(
    operation,
    key,
    `Ehhez a művelethez add át a @vercel/blob ${name} függvényét a vercelBlobStorage-nak.`,
  )
}

function privateUrl(key: string): StorageError {
  return storageError(
    'getUrl',
    key,
    'Privát Vercel Blob tárolóból nem adható olvasható URL: a fájlt a saját végpontodon át szolgáld ki a @vercel/blob get() függvényével, vagy készíts aláírt URL-t a @vercel/blob presignUrl() függvényével.',
  )
}

export function vercelBlobStorage(options: VercelBlobStorageOptions): StorageAdapter {
  const prefix = normalizePrefix(options.prefix)
  const commandOptions: VercelBlobCommandOptions = {
    access: options.access,
    ...(options.token ? { token: options.token } : {}),
  }

  return {
    async put(key: string, body: Uint8Array, putOptions: StoragePutOptions): Promise<StoredFile> {
      const fullKey = resolveKey(prefix, key)
      const blobOptions: VercelBlobPutOptions = {
        ...commandOptions,
        contentType: putOptions.contentType,
        addRandomSuffix: false,
        allowOverwrite: options.allowOverwrite ?? true,
        ...(options.cacheControlMaxAge === undefined
          ? {}
          : { cacheControlMaxAge: options.cacheControlMaxAge }),
      }
      const blob = new Blob([toArrayBuffer(body)], { type: putOptions.contentType })
      const result = await guardStorageCall('Vercel Blob', 'put', key, () =>
        options.put(fullKey, blob, blobOptions),
      )
      return {
        key,
        url: options.access === 'public' ? result.url : undefined,
        size: body.byteLength,
        contentType: putOptions.contentType,
      }
    },
    async delete(key: string): Promise<void> {
      const fullKey = resolveKey(prefix, key)
      const del = options.del
      if (!del) throw missingFunction('del', key, 'delete')
      await guardStorageCall('Vercel Blob', 'delete', key, () => del(fullKey, commandOptions))
    },
    async getUrl(key: string, urlOptions = {}): Promise<string> {
      const fullKey = resolveKey(prefix, key)
      if (urlOptions.expiresInSeconds !== undefined) {
        throw unsupportedSignedUrl('vercelBlobStorage', key)
      }
      if (options.access === 'private') throw privateUrl(key)
      const head = options.head
      if (!head) throw missingFunction('head', key, 'getUrl')
      const result = await guardStorageCall('Vercel Blob', 'getUrl', key, () =>
        head(fullKey, commandOptions),
      )
      return result.url
    },
  }
}
