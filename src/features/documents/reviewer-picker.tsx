import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  reviewInvitationLimit,
  type ReviewerCandidate,
} from '@writing/discussions'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { documentPath } from './api'

type ReviewerScope =
  | { documentId: string }
  | { assignmentId: string; submissionId: string; version: number }

export interface ReviewerSelection {
  query: string
  selected: ReviewerCandidate[]
}

export function ReviewerPicker({
  scope,
  value,
  onChange,
  limit = reviewInvitationLimit,
  disabled,
}: {
  scope?: ReviewerScope
  value: ReviewerSelection
  onChange: (value: ReviewerSelection) => void
  limit?: number
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { selected } = value
  const query = value.query.trim()
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timeout = window.setTimeout(() => setSettled(query), 220)
    return () => window.clearTimeout(timeout)
  }, [query])

  const parameters = new URLSearchParams({ query: settled })
  let path = ''
  if (scope && 'documentId' in scope)
    path = `${documentPath(scope.documentId)}/reviewers?${parameters}`
  if (scope && 'assignmentId' in scope) {
    parameters.set('submissionId', scope.submissionId)
    parameters.set('version', String(scope.version))
    path = `/api/assignments/${scope.assignmentId}/reviewers?${parameters}`
  }
  const ready = Boolean(path && query && query === settled)
  const search = useQuery({
    queryKey: ['reviewer-search', path],
    enabled: ready && !disabled,
    retry: false,
    queryFn: () => request<ReviewerCandidate[]>(path),
  })

  function remove(id: string) {
    onChange({
      ...value,
      selected: selected.filter((person) => person.id !== id),
    })
  }

  return (
    <div className='grid min-w-0 gap-2'>
      <Label className='grid gap-2'>
        {t('documents.reviewerSearch')}
        <span className='relative block min-w-0'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            type='search'
            className='ps-9'
            value={value.query}
            maxLength={254}
            autoComplete='off'
            disabled={disabled || !scope}
            placeholder={t('documents.reviewerSearchPlaceholder')}
            onChange={(event) =>
              onChange({ ...value, query: event.target.value })
            }
          />
        </span>
      </Label>
      {selected.length > 0 && (
        <ul
          aria-label={t('documents.reviewersSelected')}
          className='flex flex-wrap gap-1.5'
        >
          {selected.map((person) => (
            <li
              key={person.id}
              className='flex min-w-0 items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs'
            >
              <span className='wrap-anywhere'>
                {person.name} · {person.emailHint}
              </span>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='size-6 shrink-0'
                disabled={disabled}
                aria-label={t('documents.removeReviewer', {
                  name: person.name,
                  email: person.emailHint,
                })}
                onClick={() => remove(person.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {limit > 1 && selected.length >= limit && (
        <p className='text-sm text-muted-foreground'>
          {t('documents.reviewerSelectionLimit', { limit })}
        </p>
      )}
      {scope && query && (!ready || (!disabled && search.isPending)) && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('loading')}
        </p>
      )}
      {ready && <Problem error={search.error} />}
      {ready && search.data?.length === 0 && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('documents.noMatchingReviewers')}
        </p>
      )}
      {ready && !!search.data?.length && (
        <ul
          aria-label={t('documents.reviewerSearchResults')}
          className='max-h-52 divide-y overflow-auto rounded-md border'
        >
          {search.data.map((person) => {
            const checked = selected.some((member) => member.id === person.id)
            return (
              <li key={person.id}>
                <Label className='cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/50'>
                  <Checkbox
                    className='mt-0.5'
                    checked={checked}
                    disabled={
                      disabled ||
                      (limit > 1 && selected.length >= limit && !checked)
                    }
                    onCheckedChange={(next) => {
                      if (next === true)
                        onChange({
                          ...value,
                          selected:
                            limit === 1 ? [person] : [...selected, person],
                        })
                      else remove(person.id)
                    }}
                  />
                  <span className='grid min-w-0 gap-1 wrap-anywhere'>
                    <span>{person.name}</span>
                    <span className='text-xs font-normal text-muted-foreground'>
                      {person.emailHint}
                    </span>
                  </span>
                </Label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
