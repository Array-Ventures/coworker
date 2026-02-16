import { useState, useEffect, useMemo, memo } from 'react'
import { pptxToHtml } from '@jvmr/pptx-to-html'
import DOMPurify from 'dompurify'

type PptxViewerProps = {
  content: string
  filename: string
}

export default memo(function PptxViewer({ content, filename }: PptxViewerProps) {
  const [slides, setSlides] = useState<string[]>([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const arrayBuffer = useMemo(() => {
    const binary = atob(content)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }, [content])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    pptxToHtml(arrayBuffer, {
      width: 960,
      height: 540,
      scaleToFit: true,
      letterbox: true,
    })
      .then((result) => {
        if (cancelled) return
        setSlides(result.map((s) => DOMPurify.sanitize(s)))
        setCurrentSlide(0)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to convert presentation')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [arrayBuffer])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="material-icon text-muted-foreground animate-spin" style={{ fontSize: 24 }}>progress_activity</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <span className="material-icon text-muted-foreground mb-2" style={{ fontSize: 32 }}>error</span>
        <p className="font-secondary text-[13px] text-muted-foreground">Failed to load presentation</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="font-secondary text-[12px] text-muted-foreground">
          {slides.length > 0 ? `${slides.length} slide${slides.length > 1 ? 's' : ''}` : ''}
        </span>
        {slides.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentSlide((s) => Math.max(0, s - 1))}
              disabled={currentSlide <= 0}
              className="flex items-center rounded-lg p-[6px] bg-secondary disabled:opacity-30"
            >
              <span className="material-icon text-foreground" style={{ fontSize: 16 }}>chevron_left</span>
            </button>
            <span className="font-secondary text-[12px] text-foreground font-medium min-w-[60px] text-center">
              {currentSlide + 1} / {slides.length}
            </span>
            <button
              onClick={() => setCurrentSlide((s) => Math.min(slides.length - 1, s + 1))}
              disabled={currentSlide >= slides.length - 1}
              className="flex items-center rounded-lg p-[6px] bg-secondary disabled:opacity-30"
            >
              <span className="material-icon text-foreground" style={{ fontSize: 16 }}>chevron_right</span>
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto flex justify-center items-center py-6 bg-background">
        {slides[currentSlide] && (
          <div
            className="pptx-slide shadow-lg"
            dangerouslySetInnerHTML={{ __html: slides[currentSlide] }}
          />
        )}
      </div>
    </div>
  )
})
