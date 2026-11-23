import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import type { DocumentItem, DocumentVersion } from '@writing/documents'
import type { PersonalWriting } from '@writing/personal-writing'
import { citedSources, stages, type Stage } from '@writing/writing'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { request } from '@/features/writing/api'
import {
  PaperEditor,
  PaperText,
  type CitationInput,
} from '@/features/writing/editor'
import { ReferencesPanel } from '@/features/writing/references'
import { Problem } from '@/features/writing/ui'
import {
  documentPath,
  documentsKey,
  versionFile,
  type SavedDocument,
} from './api'
import type { ToolDialogControls } from './document-tools'
import { WritingAdviceDialog } from './writing-advice'

export function PersonalWritingEditor({
  entry,
  version,
  editable,
  versions,
  onSaved,
  stage,
  onStageChange,
  advice,
  adviceStage,
}: {
  entry: DocumentItem
  version: number
  editable: boolean
  versions: DocumentVersion[]
  onSaved: () => void
  stage: Stage
  onStageChange: (stage: Stage) => void
  advice: ToolDialogControls
  adviceStage: 'outline' | 'revise'
}) {
  const { t } = useTranslation()
  const [initialVersion] = useState(version)
  const query = useQuery({
    queryKey: [...documentsKey, entry.id, 'writing', initialVersion],
    queryFn: () =>
      request<PersonalWriting>(
        `${documentPath(entry.id)}/writing?version=${initialVersion}`
      ),
    staleTime: Infinity,
  })
  if (query.isPending) return <p role='status'>{t('loading')}</p>
  if (query.isError) return <Problem error={query.error} />
  return (
    <WritingForm
      initial={query.data}
      base={initialVersion}
      entry={entry}
      editable={editable}
      versions={versions}
      onSaved={onSaved}
      stage={stage}
      onStageChange={onStageChange}
      advice={advice}
      adviceStage={adviceStage}
    />
  )
}

function WritingForm({
  initial,
  base,
  entry,
  editable,
  versions,
  onSaved,
  stage,
  onStageChange,
  advice,
  adviceStage,
}: {
  initial: PersonalWriting
  base: number
  entry: DocumentItem
  editable: boolean
  versions: DocumentVersion[]
  onSaved: () => void
  stage: Stage
  onStageChange: (stage: Stage) => void
  advice: ToolDialogControls
  adviceStage: 'outline' | 'revise'
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const path = documentPath(entry.id)
  const [work, setWork] = useState(initial.work)
  const [saved, setSaved] = useState({ version: base, work: initial.work })
  const [citation, setCitation] = useState<CitationInput>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const changed = work !== saved.work
  const doc = stage === 'revise' ? work.revision : work.draft
  const generated = versions.find((version) => version.format === 'docx')
  const generate = useMutation({
    mutationFn: (copy: boolean) =>
      request<SavedDocument>(`${path}/generate`, 'POST', {
        base: saved.version,
        copyTitle: copy
          ? `${entry.title.slice(0, 156)} · ${t('documents.copySuffix')}`
          : undefined,
      }),
    onSuccess: (result) => {
      onSaved()
      if (result.id !== entry.id)
        void navigate({
          to: '/documents/$documentId',
          params: { documentId: result.id },
        })
    },
  })
  useBlocker({
    shouldBlockFn: () =>
      changed && !window.confirm(t('documents.leaveUnsaved')),
    enableBeforeUnload: changed,
  })

  useEffect(() => {
    if (!editable || !changed || pending || error) return
    const timeout = window.setTimeout(() => {
      setPending(true)
      void request<SavedDocument>(`${path}/writing`, 'PUT', {
        base: saved.version,
        language: initial.language,
        work,
      })
        .then((result) => {
          setSaved({ version: result.currentVersion, work })
          onSaved()
        }, setError)
        .finally(() => setPending(false))
    }, 1400)
    return () => window.clearTimeout(timeout)
  }, [
    editable,
    changed,
    pending,
    error,
    initial.language,
    path,
    work,
    saved.version,
    onSaved,
  ])

  return (
    <section className='grid gap-4' lang={initial.language}>
      <div
        className='flex flex-wrap gap-1 rounded-md border p-1'
        aria-label={t('writingWorkspace')}
      >
        {stages.map((step) => (
          <Button
            variant={step === stage ? 'secondary' : 'ghost'}
            aria-pressed={step === stage}
            key={step}
            onClick={() => {
              onStageChange(step)
              setCitation(undefined)
            }}
          >
            {t(`stage.${step}`)}
          </Button>
        ))}
      </div>
      {stage === 'goals' || stage === 'outline' || stage === 'reflect' ? (
        <Label className='grid gap-2'>
          {t(
            stage === 'goals'
              ? 'documents.writingGoal'
              : stage === 'outline'
                ? 'documents.outline'
                : 'documents.writingReflection'
          )}
          <Textarea
            className='min-h-48'
            readOnly={!editable}
            maxLength={stage === 'goals' ? 4000 : 12000}
            value={
              stage === 'goals'
                ? work.goal
                : stage === 'outline'
                  ? work.outline
                  : work.reflection
            }
            onChange={(event) => {
              const field =
                stage === 'goals'
                  ? 'goal'
                  : stage === 'outline'
                    ? 'outline'
                    : 'reflection'
              setWork({ ...work, [field]: event.target.value })
            }}
          />
        </Label>
      ) : (
        <div className='grid gap-3'>
          {editable ? (
            <>
              <Label className='grid gap-2'>
                {t('documents.name')}
                <Input
                  value={
                    stage === 'revise'
                      ? (work.revisionTitle ?? work.title)
                      : work.title
                  }
                  maxLength={180}
                  onChange={(event) =>
                    setWork({
                      ...work,
                      [stage === 'revise' ? 'revisionTitle' : 'title']:
                        event.target.value,
                    })
                  }
                />
              </Label>
              <div className='min-w-0 rounded-md border bg-card'>
                <PaperEditor
                  key={stage}
                  value={doc}
                  onChange={(value) =>
                    setWork((current) => ({
                      ...current,
                      [stage === 'revise' ? 'revision' : 'draft']: value,
                    }))
                  }
                  sources={work.sources}
                  insertion={citation}
                />
              </div>
              <ReferencesPanel
                lookupPath={`${path}/reference-doi`}
                sources={work.sources ?? []}
                cited={
                  new Set([
                    ...citedSources(work.draft),
                    ...citedSources(work.revision),
                  ])
                }
                onChange={(sources) =>
                  setWork((current) => ({ ...current, sources }))
                }
                onInsert={(value) => setCitation({ ...value })}
              />
            </>
          ) : (
            <PaperText doc={doc} sources={work.sources} />
          )}
        </div>
      )}
      {editable && (
        <>
          <Problem error={error ?? generate.error} />
          <div className='flex flex-wrap items-center gap-2'>
            <span role='status' className='text-sm text-muted-foreground'>
              {t(
                pending
                  ? 'documents.saving'
                  : changed
                    ? 'documents.unsaved'
                    : 'saved'
              )}
            </span>
            {!!error && (
              <Button variant='outline' onClick={() => setError(null)}>
                {t('retry')}
              </Button>
            )}
            <Button
              variant='outline'
              disabled={changed || generate.isPending}
              onClick={() => generate.mutate(false)}
            >
              {t('documents.generateWord')}
            </Button>
            <Button
              variant='outline'
              disabled={changed || generate.isPending}
              onClick={() => generate.mutate(true)}
            >
              {t('documents.editableCopy')}
            </Button>
            {generated && (
              <Button variant='ghost' asChild>
                <a href={versionFile(entry.id, generated.number)} download>
                  {t('documents.latestWord')}
                </a>
              </Button>
            )}
          </div>
          <p className='text-sm text-muted-foreground'>
            {t(
              !generated || generated.sourceVersion !== saved.version || changed
                ? 'documents.newerWriting'
                : 'documents.copyHint'
            )}
          </p>
          <WritingAdviceDialog
            id={entry.id}
            version={saved.version}
            work={work}
            stage={adviceStage}
            canRequest={stage === adviceStage && !changed}
            controls={advice}
          />
        </>
      )}
    </section>
  )
}
