import { useState, useEffect, useMemo, memo } from 'react'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'

type DocxViewerProps = {
  content: string
  filename: string
}

export default memo(function DocxViewer({ content, filename }: DocxViewerProps) {
  const [html, setHtml] = useState<string>('')
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

    mammoth.convertToHtml({ arrayBuffer })
      .then((result) => {
        if (cancelled) return
        setHtml(DOMPurify.sanitize(result.value))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to convert document')
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
        <p className="font-secondary text-[13px] text-muted-foreground">Failed to load document</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="font-secondary text-[12px] text-muted-foreground">
          Word Document
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className="docx-preview max-w-[800px] mx-auto px-10 py-8"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
})
