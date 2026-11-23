import type { DocumentItem } from '@writing/documents'
import { RequestError } from '@/features/writing/api'

export const documentsKey = ['personal-documents']
export const discussionsPath = '/api/review-discussions'
export const discussionsKey = ['review-discussions']
export const documentPath = (id?: string) =>
  `/api/documents${id ? `/${id}` : ''}`
export const versionFile = (id: string, number: number) =>
  `${documentPath(id)}/versions/${number}/file`

export interface DocumentList {
  items: DocumentItem[]
  total: number
  tags: string[]
}

export interface SavedDocument {
  id: string
  currentVersion: number
}

export async function readMarkdown(id: string, version: number) {
  const response = await fetch(versionFile(id, version))
  if (!response.ok)
    throw new RequestError(
      response.status,
      response.status === 404 ? 'notFound' : 'default'
    )
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    await response.arrayBuffer()
  )
}

export function uploadDocument(
  file: Blob,
  filename: string,
  target?: Pick<DocumentItem, 'id' | 'currentVersion'>,
  progress?: (percent: number) => void
) {
  const pathname = target
    ? `${documentPath(target.id)}/versions`
    : `${documentPath()}/upload`
  const query = new URLSearchParams({ filename })
  if (target) query.set('base', String(target.currentVersion))
  return new Promise<SavedDocument>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${pathname}?${query}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300)
        resolve(xhr.response as SavedDocument)
      else reject(new RequestError(xhr.status, xhr.response?.code ?? 'default'))
    }
    xhr.onerror = () => reject(new RequestError(0, 'default'))
    xhr.ontimeout = xhr.onerror
    xhr.timeout = 120_000
    xhr.send(file)
  })
}
