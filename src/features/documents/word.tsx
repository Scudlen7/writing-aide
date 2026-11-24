import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { request } from '@/features/writing/api'
import { Problem } from '@/features/writing/ui'
import { documentPath } from './api'

type OfficeLaunch = {
  id: string
  api: string
  settings: Record<string, unknown>
}
type OfficeStatus = {
  state: 'open' | 'saved' | 'closed' | 'failed' | 'conflict'
  pending: boolean
  finished: boolean
  savedVersion: number | null
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        id: string,
        settings: Record<string, unknown>
      ) => { destroyEditor: () => void }
    }
  }
}

const scripts = new Map<string, Promise<void>>()
function loadOffice(url: string) {
  let script = scripts.get(url)
  if (!script) {
    script = new Promise<void>((resolve, reject) => {
      const element = document.createElement('script')
      element.src = url
      element.onload = () => resolve()
      element.onerror = () => {
        scripts.delete(url)
        element.remove()
        reject(new Error())
      }
      document.head.append(element)
    })
    scripts.set(url, script)
  }
  return script
}

export function WordEditor({
  id,
  version,
  canEdit,
  onSaved,
  autoOpen,
}: {
  id: string
  version: number
  canEdit: boolean
  onSaved: () => void
  autoOpen?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [show, setShow] = useState(false)
  const [editable, setEditable] = useState(false)
  const opened = useRef(false)
  const launch = useMutation({
    mutationFn: (edit: boolean) =>
      request<OfficeLaunch>(`${documentPath(id)}/office`, 'POST', {
        version,
        edit,
        language: i18n.language === 'en' ? 'en' : 'zh-CN',
        mobile: !window.matchMedia('(min-width: 768px)').matches,
      }),
    onSuccess: (_result, edit) => {
      setEditable(edit)
      setShow(true)
    },
  })
  const { mutate: openEditor } = launch
  useEffect(() => {
    if (!autoOpen || opened.current) return
    opened.current = true
    openEditor(canEdit && window.matchMedia('(min-width: 768px)').matches)
  }, [autoOpen, canEdit, openEditor])
  return (
    <div className='grid gap-3'>
      {!show && (
        <div className='flex flex-wrap gap-2'>
          <Button
            variant={canEdit ? 'outline' : 'default'}
            onClick={() => launch.mutate(false)}
            disabled={launch.isPending}
          >
            {t('documents.previewWord')}
          </Button>
          {canEdit && (
            <Button
              className='hidden md:inline-flex'
              onClick={() => launch.mutate(true)}
              disabled={launch.isPending}
            >
              {t('documents.editWord')}
            </Button>
          )}
        </div>
      )}
      <Problem error={launch.error} />
      {launch.data && (
        <OfficeFrame
          key={launch.data.id}
          launch={launch.data}
          show={show}
          editable={editable}
          onClose={() => setShow(false)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function OfficeFrame({
  launch: editorLaunch,
  show,
  editable,
  onClose,
  onSaved,
}: {
  launch: OfficeLaunch
  show: boolean
  editable: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [error, setError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const url = `/api/office/session/${editorLaunch.id}`
  const status = useQuery({
    queryKey: ['word-save', url],
    queryFn: () => request<OfficeStatus>(url),
    enabled: editable,
    refetchInterval: (query) => (query.state.data?.finished ? false : 2200),
    retry: false,
  })
  const {
    mutate: saveWord,
    isPending: savingWord,
    error: saveError,
  } = useMutation({
    mutationFn: () => request(`${url}/save`, 'POST'),
    onSuccess: () => {
      void status.refetch()
    },
  })

  useEffect(() => {
    if (!show) return
    let live = true
    let editor: { destroyEditor: () => void } | undefined
    void loadOffice(editorLaunch.api)
      .then(() => {
        if (!live) return
        if (!window.DocsAPI) throw new Error()
        editor = new window.DocsAPI.DocEditor(id, {
          ...editorLaunch.settings,
          events: {
            onError: () => setError(true),
            onDocumentStateChange: (event: { data: boolean }) => {
              setSyncing(event.data)
              if (event.data) setDirty(true)
            },
          },
        })
      })
      .catch(() => {
        if (live) setError(true)
      })
    const renew = setInterval(() => {
      void request(url, 'PUT').catch(() => {
        if (live) setError(true)
      })
    }, 10 * 60_000)
    return () => {
      live = false
      clearInterval(renew)
      editor?.destroyEditor()
    }
  }, [id, editorLaunch, show, url])

  const persisted = status.data?.savedVersion ?? null
  useEffect(() => {
    if (persisted) onSaved()
  }, [persisted, onSaved])
  if (persisted !== savedVersion) {
    setSavedVersion(persisted)
    setDirty(false)
  }

  return (
    <div className='grid gap-2'>
      {show && (
        <div className='flex flex-wrap items-center gap-2'>
          {editable && (
            <Button
              variant='outline'
              onClick={() => saveWord()}
              disabled={
                savingWord ||
                syncing ||
                status.data?.pending ||
                status.data?.finished ||
                error
              }
            >
              {t('documents.saveWord')}
            </Button>
          )}
          <Button variant='outline' onClick={onClose}>
            {t('documents.closeWord')}
          </Button>
        </div>
      )}
      <Problem error={saveError ?? status.error} />
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {t('error.officeUnavailable')}
        </p>
      )}
      {editable && (
        <p role='status' className='text-sm text-muted-foreground'>
          {t(
            status.data?.state === 'conflict'
              ? 'documents.wordConflict'
              : status.data?.state === 'failed'
                ? 'error.officeSaveFailed'
                : status.data?.pending || (!show && !status.data?.finished)
                  ? 'documents.wordSaving'
                  : status.data?.state === 'saved' && !dirty
                    ? 'saved'
                    : dirty
                      ? 'documents.unsaved'
                      : 'documents.wordReady'
          )}
        </p>
      )}
      {show && (
        <div className='h-[75vh] min-h-96 overflow-hidden rounded-md border md:h-[90dvh]'>
          <div id={id} />
        </div>
      )}
    </div>
  )
}
