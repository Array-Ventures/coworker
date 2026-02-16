import { useState, useCallback, lazy, Suspense, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { uploadWorkspaceFile } from '../../mastra-client'

const CodeViewer = lazy(() => import('./CodeViewer'))

type MarkdownViewerProps = {
  content: string
  filename: string
  filePath: string
  onContentChange?: (content: string) => void
}

export default memo(function MarkdownViewer({ content, filename, filePath, onContentChange }: MarkdownViewerProps) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [currentContent, setCurrentContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleContentChange = useCallback((newContent: string) => {
    setCurrentContent(newContent)
    onContentChange?.(newContent)
  }, [onContentChange])

  const handleSaveFromPreview = useCallback(async () => {
    setSaving(true)
    try {
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      await uploadWorkspaceFile(dir, filename, currentContent, 'utf-8')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [currentContent, filePath, filename])

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center rounded-lg bg-secondary p-0.5">
          <button
            onClick={() => setMode('preview')}
            className={`rounded-md px-3 py-1 font-secondary text-[12px] font-medium transition-colors ${
              mode === 'preview' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setMode('code')}
            className={`rounded-md px-3 py-1 font-secondary text-[12px] font-medium transition-colors ${
              mode === 'code' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            Code
          </button>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="font-secondary text-[12px] text-green-500 flex items-center gap-1">
              <span className="material-icon" style={{ fontSize: 14 }}>check</span>
              Saved
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {mode === 'preview' ? (
          <div className="px-12 py-8 max-w-[800px] mx-auto markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
          </div>
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center py-16"><span className="material-icon text-muted-foreground animate-spin" style={{ fontSize: 24 }}>progress_activity</span></div>}>
            <CodeViewer
              content={currentContent}
              filename={filename}
              filePath={filePath}
              onContentChange={handleContentChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
})
