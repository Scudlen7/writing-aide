import { z } from 'zod'

export const uploadFormats = ['docx', 'doc', 'pdf', 'md'] as const
export type UploadFormat = (typeof uploadFormats)[number]
export type DocumentFormat = UploadFormat | 'writing'

export const documentTitle = z.string().trim().min(1).max(180)
export const documentTag = z.string().trim().normalize('NFKC').min(1).max(40)
export const documentTags = z
  .array(documentTag)
  .max(20)
  .transform((tags) => [...new Set(tags)])

export function searchText(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

export const documentTypes: Record<DocumentFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
  md: 'text/plain; charset=utf-8',
  writing: 'application/json; charset=utf-8',
}

export interface DocumentItem {
  id: string
  title: string
  source: 'upload' | 'word' | 'writing' | 'course'
  tags: string[]
  currentVersion: number
  updatedAt: string
  trashedAt: string | null
  filename: string
  format: DocumentFormat
  indexStatus: 'pending' | 'ready' | 'empty' | 'failed'
  indexError: string | null
  excerpt?: string | null
}

export interface DocumentVersion {
  number: number
  sourceVersion: number | null
  conflict: boolean
  filename: string
  format: DocumentFormat
  author: string
  bytes: number
  createdAt: string
  indexStatus: DocumentItem['indexStatus']
  indexError: string | null
}
