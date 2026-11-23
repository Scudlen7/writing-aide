import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import type { SavedDocument } from './api'

export function CourseCopyButton({
  assignmentId,
  previous,
}: {
  assignmentId: string
  previous?: boolean
}) {
  const { t } = useTranslation()
  const [copy, setCopy] = useState<SavedDocument | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function saveCopy() {
    setPending(true)
    setError(null)
    try {
      setCopy(
        await request<SavedDocument>(
          `/api/assignments/${assignmentId}/export${previous ? '?previous=1' : ''}`,
          'POST'
        )
      )
    } catch (error) {
      setError(error)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className='space-y-1'>
      {copy ? (
        <Button asChild variant='outline' size='sm'>
          <a href={`/documents/${copy.id}`}>{t('documents.openCopy')}</a>
        </Button>
      ) : (
        <Button
          variant='outline'
          size='sm'
          onClick={() => void saveCopy()}
          disabled={pending}
        >
          {t('documents.saveCourseCopy')}
        </Button>
      )}
      <Problem error={error} />
    </div>
  )
}
