import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { debateExcerptLimit, type DebateExcerpt } from '@writing/debate'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

function countThrough(positions: number[], offset: number) {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (positions[middle] <= offset) low = middle + 1
    else high = middle
  }
  return low
}

function prepareSource(paragraphs: string[]) {
  let offset = 0
  const starts = paragraphs.map((paragraph) => {
    const start = offset
    offset += paragraph.length + 1
    return start
  })
  const original = paragraphs.join('\n')
  const mergedBreaks: number[] = []
  // Textarea selection offsets count a CRLF as one character.
  const value = original.replace(/\r\n?/g, (lineBreak, index: number) => {
    if (lineBreak.length === 2) mergedBreaks.push(index - mergedBreaks.length)
    return '\n'
  })
  return { original, value, starts, mergedBreaks }
}

function revealMatch(source: HTMLTextAreaElement, start: number, end: number) {
  source.focus({ preventScroll: true })
  source.setSelectionRange(start, end)

  // Measure the wrapped match because selecting it does not scroll a textarea.
  const style = getComputedStyle(source)
  const mirror = document.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    visibility: 'hidden',
    width: `${source.clientWidth}px`,
    boxSizing: 'border-box',
    padding: style.padding,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    tabSize: style.tabSize,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  })
  const text = document.createTextNode(source.value)
  mirror.append(text)
  document.body.append(mirror)
  const marker = document.createRange()
  marker.setStart(text, start)
  marker.setEnd(text, start + 1)
  const top =
    marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top
  mirror.remove()
  source.scrollTop = top - source.clientHeight / 3
}

export function DebateSelection({
  paragraphs,
  ranges,
  onChange,
}: {
  paragraphs: string[]
  ranges: DebateExcerpt[]
  onChange: (ranges: DebateExcerpt[]) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const [term, setTerm] = useState('')
  const [activeMatch, setActiveMatch] = useState(-1)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const source = useMemo(() => prepareSource(paragraphs), [paragraphs])
  const matches = useMemo(() => {
    const keyword = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!keyword) return []
    return Array.from(
      source.value.matchAll(new RegExp(keyword, 'giu')),
      (match) => ({
        start: match.index,
        end: match.index + match[0].length,
      })
    )
  }, [source.value, term])
  const selectedLength = ranges.reduce(
    (length, range) => length + range.text.length,
    0
  )

  function originalOffset(offset: number) {
    return offset + countThrough(source.mergedBreaks, offset - 1)
  }

  function positionAt(offset: number) {
    const paragraph = Math.max(0, countThrough(source.starts, offset) - 1)
    return { paragraph, offset: offset - (source.starts[paragraph] ?? 0) }
  }

  const currentParagraph = positionAt(originalOffset(selection.start)).paragraph

  function moveMatch(direction: -1 | 1) {
    const textarea = sourceRef.current
    if (!textarea || matches.length === 0) return
    const from = activeMatch < 0 && direction < 0 ? 0 : activeMatch
    const next = (from + direction + matches.length) % matches.length
    const match = matches[next]
    setActiveMatch(next)
    setSelection(match)
    revealMatch(textarea, match.start, match.end)
  }

  function navigateOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    moveMatch(event.shiftKey ? -1 : 1)
  }

  function addPassage(start: number, end: number) {
    const text = source.original.slice(start, end)
    if (!text.trim()) {
      setProblem('documents.debateSelectionEmpty')
      return
    }
    if (selectedLength + text.length > debateExcerptLimit) {
      setProblem('documents.debateSelectionTooLong')
      return
    }
    const positionOffset = (position: DebateExcerpt['start']) =>
      source.starts[position.paragraph] + position.offset
    if (
      ranges.some(
        (range) =>
          start < positionOffset(range.end) && end > positionOffset(range.start)
      )
    ) {
      setProblem('documents.debateSelectionOverlap')
      return
    }
    onChange(
      [
        ...ranges,
        { start: positionAt(start), end: positionAt(end), text },
      ].sort(
        (left, right) =>
          positionOffset(left.start) - positionOffset(right.start)
      )
    )
    setProblem(null)
    return true
  }

  function addParagraphRange() {
    if (rangeStart === null) return
    if (currentParagraph < rangeStart) {
      setProblem('documents.debateRangeBeforeStart')
      return
    }
    if (
      addPassage(
        source.starts[rangeStart],
        source.starts[currentParagraph] + paragraphs[currentParagraph].length
      )
    ) {
      setRangeStart(null)
    }
  }

  return (
    <div className='grid min-w-0 gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
      <div className='grid min-w-0 content-start gap-2'>
        <Label htmlFor={`${id}-source`}>{t('documents.debateSource')}</Label>
        <p id={`${id}-source-hint`} className='text-xs text-muted-foreground'>
          {t('documents.debateSelectionHint')}
        </p>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            className='min-w-0 flex-1 basis-32'
            type='search'
            aria-label={t('documents.debateFindPassage')}
            placeholder={t('documents.debateFindPassage')}
            value={term}
            onChange={(event) => {
              setTerm(event.currentTarget.value)
              setActiveMatch(-1)
            }}
            onKeyDown={navigateOnEnter}
          />
          <div className='flex gap-1'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('documents.debatePreviousMatch')}
              disabled={!matches.length}
              onClick={() => moveMatch(-1)}
            >
              <ChevronUp />
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('documents.debateNextMatch')}
              disabled={!matches.length}
              onClick={() => moveMatch(1)}
            >
              <ChevronDown />
            </Button>
          </div>
        </div>
        {term.trim() && (
          <p className='text-xs text-muted-foreground' role='status'>
            {activeMatch >= 0
              ? t('documents.debateMatchCount', {
                  current: activeMatch + 1,
                  total: matches.length,
                })
              : matches.length
                ? t('documents.debateMatchesFound', { total: matches.length })
                : t('documents.debateNoMatches')}
          </p>
        )}
        <Textarea
          ref={sourceRef}
          id={`${id}-source`}
          aria-describedby={`${id}-source-hint`}
          className='field-sizing-fixed h-44 min-w-0 resize-y wrap-break-word md:h-60'
          readOnly
          value={source.value}
          onKeyDown={navigateOnEnter}
          onSelect={(event) => {
            const { selectionStart, selectionEnd } = event.currentTarget
            setSelection({ start: selectionStart, end: selectionEnd })
          }}
        />
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
          <span>
            {t('documents.debateCurrentParagraph', {
              number: currentParagraph + 1,
            })}
          </span>
          {rangeStart !== null && (
            <span role='status'>
              {t('documents.debateRangeStart', { number: rangeStart + 1 })}
            </span>
          )}
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={selection.start === selection.end}
            onClick={() =>
              addPassage(
                originalOffset(selection.start),
                originalOffset(selection.end)
              )
            }
          >
            {t('documents.debateAddSelection')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => {
              setRangeStart(currentParagraph)
              setProblem(null)
            }}
          >
            {t('documents.debateSetStart')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={rangeStart === null}
            onClick={addParagraphRange}
          >
            {t('documents.debateAddThrough')}
          </Button>
        </div>
        {problem && (
          <p className='text-sm text-destructive' role='alert'>
            {t(problem, { limit: debateExcerptLimit })}
          </p>
        )}
      </div>
      <section aria-labelledby={`${id}-selected`} className='min-w-0 space-y-2'>
        <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
          <h3 id={`${id}-selected`} className='text-sm font-medium'>
            {t('documents.debateSelectedPassages')}
          </h3>
          <p className='text-xs text-muted-foreground' role='status'>
            {t('documents.debateSelectedCount', {
              length: selectedLength,
              limit: debateExcerptLimit,
            })}
          </p>
        </div>
        {ranges.length === 0 ? (
          <p className='rounded-md border border-dashed p-3 text-sm text-muted-foreground'>
            {t('documents.debateNoPassages')}
          </p>
        ) : (
          <>
            <p className='text-xs text-muted-foreground'>
              {t('documents.modelInput')}
            </p>
            <ol className='max-h-60 min-w-0 space-y-2 overflow-y-auto rounded-md border p-2'>
              {ranges.map((range, index) => {
                const start = range.start.paragraph + 1
                const end =
                  range.end.paragraph + (range.end.offset === 0 ? 0 : 1)
                return (
                  <li
                    key={`${range.start.paragraph}:${range.start.offset}`}
                    className='min-w-0 rounded-md bg-muted/50 p-2'
                  >
                    <div className='flex items-start justify-between gap-2'>
                      <p className='text-xs font-medium text-muted-foreground'>
                        {start === end
                          ? t('documents.debateCurrentParagraph', {
                              number: start,
                            })
                          : t('documents.debatePassageLocation', {
                              start,
                              end,
                            })}
                      </p>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-7'
                        aria-label={t('documents.debateRemovePassage', {
                          number: index + 1,
                        })}
                        onClick={() => {
                          onChange(
                            ranges.filter((_, position) => position !== index)
                          )
                          setProblem(null)
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                    <blockquote className='text-sm wrap-anywhere whitespace-pre-wrap'>
                      {range.text}
                    </blockquote>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </section>
    </div>
  )
}
