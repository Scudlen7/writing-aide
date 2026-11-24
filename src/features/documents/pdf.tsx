import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { searchText } from '@writing/documents'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

GlobalWorkerOptions.workerSrc = workerUrl

const assets = import.meta.glob(
  '../../../node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm,iccs}/*',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>
const files = new Map(
  Object.entries(assets).map(([name, url]) => [name.split('/').at(-1), url])
)
type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
type PageSize = { width: number; height: number }

const PdfPage = memo(function PdfPage({
  pdf,
  number,
  firstPageSize,
  pageWidth,
  zoom,
  nearby,
  label,
  setError,
}: {
  pdf: PDFDocumentProxy
  number: number
  firstPageSize: PageSize
  pageWidth: number
  zoom: number
  nearby: boolean
  label: string
  setError: (error: boolean) => void
}) {
  const [size, setSize] = useState(firstPageSize)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const width = Math.min(size.width * 1.5, pageWidth) * zoom
  const height = (width * size.height) / size.width

  useEffect(() => {
    const target = canvas.current
    const text = layer.current
    if (!nearby || !target || !text) return
    let live = true
    let data: PDFPageProxy | undefined
    let render: RenderTask | undefined
    let textLayer: TextLayer | undefined
    void (async () => {
      data = await pdf.getPage(number)
      if (!live) return
      const original = data.getViewport({ scale: 1 })
      setSize((previous) =>
        previous.width === original.width && previous.height === original.height
          ? previous
          : { width: original.width, height: original.height }
      )
      const view = data.getViewport({
        scale: Math.min(1.5, pageWidth / original.width) * zoom,
      })
      const ratio = Math.min(
        window.devicePixelRatio,
        2,
        4000 / Math.max(view.width, view.height)
      )
      target.width = Math.round(view.width * ratio)
      target.height = Math.round(view.height * ratio)
      text.style.setProperty('--scale-factor', String(view.scale))
      text.style.setProperty('--total-scale-factor', String(view.scale))
      render = data.render({
        canvas: target,
        viewport: view,
        transform: [ratio, 0, 0, ratio, 0, 0],
      })
      await render.promise
      if (!live) return
      textLayer = new TextLayer({
        textContentSource: data.streamTextContent(),
        container: text,
        viewport: view,
      })
      await textLayer.render()
    })().catch(() => {
      if (live) setError(true)
    })
    return () => {
      live = false
      render?.cancel()
      textLayer?.cancel()
      text.replaceChildren()
      target.width = 0
      target.height = 0
      if (!target.isConnected) data?.cleanup()
    }
  }, [pdf, number, zoom, pageWidth, nearby, setError])

  return (
    <div data-page={number} className='grid justify-items-center'>
      <div className='relative bg-white' style={{ width, height }}>
        {nearby && (
          <>
            <canvas
              ref={canvas}
              aria-label={label}
              className='block size-full'
            />
            <div className='textLayer' ref={layer} />
          </>
        )}
      </div>
    </div>
  )
})

export default function PdfPreview({ url }: { url: string }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<{
    pdf: PDFDocumentProxy
    firstPageSize: PageSize
  } | null>(null)
  const pdf = loaded?.pdf
  const [error, setError] = useState(false)
  const [password, setPassword] = useState<((value: string) => void) | null>(
    null
  )
  const [wrongPassword, setWrongPassword] = useState(false)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [outline, setOutline] = useState<Outline>([])
  const [pageWidth, setPageWidth] = useState(800)
  const [nearbyPages, setNearbyPages] = useState<ReadonlySet<number>>(
    () => new Set([1])
  )
  const [term, setTerm] = useState('')
  const [match, setMatch] = useState<'missing' | 'searching' | 'found' | null>(
    null
  )
  const wrapper = useRef<HTMLDivElement>(null)
  const search = useRef<AbortController | null>(null)
  const jumpPosition = useRef<number | null>(null)
  const zoomAnchor = useRef<{ page: number; offset: number } | null>(null)

  useEffect(() => {
    let live = true
    const task = getDocument({
      url,
      useWorkerFetch: false,
      cMapUrl: './',
      standardFontDataUrl: './',
      wasmUrl: './',
      iccUrl: './',
      BinaryDataFactory: class {
        async fetch({ filename }: { filename: string }) {
          const asset = files.get(filename.split('/').at(-1))
          if (!asset) throw new Error('PDF asset unavailable')
          const response = await fetch(asset)
          if (!response.ok) throw new Error('PDF asset unavailable')
          return new Uint8Array(await response.arrayBuffer())
        }
      },
    })
    task.onPassword = (update: (value: string) => void, reason: number) => {
      if (!live) return
      setWrongPassword(reason === 2)
      setPassword(() => update)
    }
    void task.promise
      .then(async (document) => {
        const first = await document.getPage(1)
        if (!live) return
        setLoaded({
          pdf: document,
          firstPageSize: first.getViewport({ scale: 1 }),
        })
        setPassword(null)
        const toc = await document.getOutline().catch(() => null)
        if (live) setOutline(toc ?? [])
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => {
      live = false
      search.current?.abort()
      void task.destroy().catch(() => {})
    }
  }, [url])

  useEffect(() => {
    const element = wrapper.current
    if (error || !element || !pdf) return
    const resize = new ResizeObserver(([item]) =>
      setPageWidth(Math.max(250, item.contentRect.width - 20))
    )
    resize.observe(element)
    // Keep nearby pages ready and release canvases as they leave the reading area.
    const intersection = new IntersectionObserver(
      (entries) => {
        setNearbyPages((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const number = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(number)
            else next.delete(number)
          }
          return next
        })
      },
      { root: element, rootMargin: '600px 0px' }
    )
    for (const child of element.children) intersection.observe(child)
    return () => {
      resize.disconnect()
      intersection.disconnect()
    }
  }, [error, pdf])

  useLayoutEffect(() => {
    const element = wrapper.current
    const anchor = zoomAnchor.current
    if (!element || !anchor) return
    const target = element.children[anchor.page - 1] as HTMLElement
    element.scrollTop = target.offsetTop + anchor.offset * target.offsetHeight
    jumpPosition.current = element.scrollTop
    zoomAnchor.current = null
  }, [zoom])

  function goToPage(number: number) {
    const element = wrapper.current
    const target = element?.children[number - 1] as HTMLElement | undefined
    if (!element || !target) return
    const first = element.firstElementChild as HTMLElement
    element.scrollTop = target.offsetTop - first.offsetTop
    jumpPosition.current = element.scrollTop
    setPage(number)
  }

  function trackPage(element: HTMLDivElement) {
    const { children, clientHeight, scrollHeight, scrollTop } = element
    if (scrollTop === jumpPosition.current) return
    jumpPosition.current = null
    if (scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 1) {
      setPage(children.length)
      return
    }
    const readingLine = scrollTop + Math.min(120, clientHeight / 4)
    let first = 0
    let last = children.length - 1
    while (first < last) {
      const middle = Math.ceil((first + last) / 2)
      if ((children[middle] as HTMLElement).offsetTop <= readingLine)
        first = middle
      else last = middle - 1
    }
    setPage(first + 1)
  }

  function changeZoom(next: number) {
    if (next === zoom) return
    const element = wrapper.current
    const target = element?.children[page - 1] as HTMLElement | undefined
    if (element && target && target.offsetHeight) {
      zoomAnchor.current = {
        page,
        offset: (element.scrollTop - target.offsetTop) / target.offsetHeight,
      }
    }
    setZoom(next)
  }

  async function find() {
    const needle = searchText(term)
    if (!pdf || !needle) return
    search.current?.abort()
    const task = new AbortController()
    search.current = task
    setMatch('searching')
    try {
      for (
        let offset = 1;
        offset <= pdf.numPages && !task.signal.aborted;
        offset++
      ) {
        const next = ((page - 1 + offset) % pdf.numPages) + 1
        const p = await pdf.getPage(next)
        const content = await p.getTextContent()
        if (task.signal.aborted) return
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''
          )
          .join('')
        if (searchText(text).includes(needle)) {
          goToPage(next)
          setMatch('found')
          return
        }
      }
      if (!task.signal.aborted) setMatch('missing')
    } catch {
      if (!task.signal.aborted) setError(true)
    }
  }

  async function jump(destination: Outline[number]['dest']) {
    if (!pdf || !destination) return
    const dest =
      typeof destination === 'string'
        ? await pdf.getDestination(destination)
        : destination
    if (!dest) return
    const target = dest[0]
    const index =
      typeof target === 'number' ? target : await pdf.getPageIndex(target)
    goToPage(index + 1)
  }

  function contents(items: Outline) {
    return (
      <ul className='ms-3 grid gap-1'>
        {items.map((item, index) => (
          <li key={index}>
            {item.dest ? (
              <Button
                className='h-auto justify-start px-2 text-start whitespace-normal'
                variant='ghost'
                onClick={() => void jump(item.dest).catch(() => setError(true))}
              >
                {item.title}
              </Button>
            ) : (
              <span>{item.title}</span>
            )}
            {item.items.length > 0 && contents(item.items)}
          </li>
        ))}
      </ul>
    )
  }

  const pages = useMemo(() => {
    if (!loaded) return null
    return Array.from({ length: loaded.pdf.numPages }, (_, index) => (
      <PdfPage
        key={index + 1}
        pdf={loaded.pdf}
        number={index + 1}
        firstPageSize={loaded.firstPageSize}
        pageWidth={pageWidth}
        zoom={zoom}
        nearby={nearbyPages.has(index + 1)}
        label={`${t('documents.page')} ${index + 1}`}
        setError={setError}
      />
    ))
  }, [loaded, nearbyPages, pageWidth, t, zoom])

  if (error)
    return (
      <p
        role='alert'
        className='rounded-md bg-destructive/10 p-3 text-destructive'
      >
        {t('documents.pdfError')}
      </p>
    )
  if (password)
    return (
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          password(String(data.get('password')))
          event.currentTarget.reset()
        }}
      >
        <Input
          className='w-auto'
          type='password'
          name='password'
          aria-label={t('documents.pdfPassword')}
          placeholder={t('documents.pdfPassword')}
          autoComplete='off'
          required
        />
        <Button>{t('documents.pdfUnlock')}</Button>
        {wrongPassword && <p role='alert'>{t('documents.wrongPdfPassword')}</p>}
      </form>
    )
  if (!pdf) return <p role='status'>{t('loading')}</p>
  return (
    <section className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
        >
          {t('documents.previous')}
        </Button>
        <Input
          className='w-20'
          type='number'
          min={1}
          max={pdf.numPages}
          value={page}
          aria-label={t('documents.page')}
          onChange={(event) => {
            const number = event.target.valueAsNumber
            if (
              Number.isInteger(number) &&
              number >= 1 &&
              number <= pdf.numPages
            )
              goToPage(number)
          }}
        />
        <span className='text-sm'>/ {pdf.numPages}</span>
        <Button
          size='sm'
          variant='outline'
          disabled={page >= pdf.numPages}
          onClick={() => goToPage(page + 1)}
        >
          {t('documents.next')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          aria-label={t('documents.zoomOut')}
          disabled={zoom <= 0.5}
          onClick={() => changeZoom(zoom - 0.25)}
        >
          −
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => changeZoom(1)}
          aria-label={t('documents.fitPage')}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          size='sm'
          variant='outline'
          aria-label={t('documents.zoomIn')}
          disabled={zoom >= 3}
          onClick={() => changeZoom(zoom + 0.25)}
        >
          +
        </Button>
      </div>
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          void find()
        }}
      >
        <Input
          className='w-auto'
          type='search'
          aria-label={t('documents.pdfFind')}
          placeholder={t('documents.pdfFind')}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            search.current?.abort()
            setMatch(null)
          }}
          maxLength={180}
        />
        <Button
          variant='outline'
          disabled={!term.trim() || match === 'searching'}
        >
          {t('documents.pdfFind')}
        </Button>
        {match && (
          <span role='status' className='text-sm'>
            {t(`documents.pdfMatch.${match}`)}
          </span>
        )}
      </form>
      {outline.length > 0 && (
        <details className='rounded-md border p-2'>
          <summary>{t('documents.outline')}</summary>
          {contents(outline)}
        </details>
      )}
      <div
        ref={wrapper}
        role='region'
        aria-label={t('documents.format.pdf')}
        tabIndex={0}
        onScroll={(event) => trackPage(event.currentTarget)}
        className='relative grid max-h-[75dvh] gap-3 overflow-auto rounded-md border bg-muted p-2'
      >
        {pages}
      </div>
    </section>
  )
}
