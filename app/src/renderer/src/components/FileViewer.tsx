import { useState, useEffect, useCallback, lazy, Suspense, memo } from 'react'
import { readWorkspaceFile } from '../mastra-client'

const CodeViewer = lazy(() => import('./viewers/CodeViewer'))
const MarkdownViewer = lazy(() => import('./viewers/MarkdownViewer'))
const ImageViewer = lazy(() => import('./viewers/ImageViewer'))
const PdfViewer = lazy(() => import('./viewers/PdfViewer'))
const DocxViewer = lazy(() => import('./viewers/DocxViewer'))
const XlsxViewer = lazy(() => import('./viewers/XlsxViewer'))
const PptxViewer = lazy(() => import('./viewers/PptxViewer'))
import UnsupportedViewer from './viewers/UnsupportedViewer'

type FileViewerProps = {
  filePath: string
  filename: string
  currentPath: string
  onClose: () => void
}

type ViewerType = 'code' | 'markdown' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'unsupported'

function getViewerType(filename: string): ViewerType {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
      return 'markdown'
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return 'image'
    case 'pdf':
      return 'pdf'
    case 'doc': case 'docx':
      return 'docx'
    case 'xls': case 'xlsx':
      return 'xlsx'
    case 'ppt': case 'pptx':
      return 'pptx'
    case 'js': case 'ts': case 'tsx': case 'jsx': case 'json': case 'html': case 'css':
    case 'py': case 'yaml': case 'yml': case 'toml':
      return 'code'
    case 'txt': case 'log': case 'env': case 'cfg':
      return 'text'
    default:
      return 'unsupported'
  }
}

function isBinaryType(type: ViewerType) {
  return type === 'image' || type === 'pdf' || type === 'docx' || type === 'xlsx' || type === 'pptx'
}

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-16">
    <span className="material-icon text-muted-foreground animate-spin" style={{ fontSize: 24 }}>progress_activity</span>
  </div>
)

export default memo(function FileViewer({ filePath, filename, currentPath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fileSize, setFileSize] = useState<number | undefined>()
  const [mimeType, setMimeType] = useState<string | undefined>()

  const viewerType = getViewerType(filename)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setContent(null)

    const encoding = isBinaryType(viewerType) ? 'base64' : 'utf-8'

    readWorkspaceFile(filePath, encoding)
      .then((res) => {
        if (cancelled) return
        setContent(res.content)
        setFileSize(res.size)
        setMimeType(res.mimeType)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to read file')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [filePath, viewerType])

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
  }, [])

  // Build breadcrumb segments from currentPath
  const pathSegments = currentPath.split('/').filter(Boolean)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between h-[48px] px-6 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg px-[10px] py-[6px] font-secondary text-[13px] font-medium text-foreground bg-secondary hover:bg-muted transition-colors"
          >
            <span className="material-icon" style={{ fontSize: 16 }}>arrow_back</span>
            Back
          </button>
          <div className="flex items-center gap-1.5 font-secondary text-[13px]">
            {pathSegments.map((seg, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="material-icon text-muted-foreground" style={{ fontSize: 14 }}>chevron_right</span>
                <span className="text-muted-foreground">{seg}</span>
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="material-icon text-muted-foreground" style={{ fontSize: 14 }}>chevron_right</span>
              <span className="text-foreground font-semibold">{filename}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!content) return
              const blob = isBinaryType(viewerType)
                ? new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))])
                : new Blob([content], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = filename
              a.click()
              URL.revokeObjectURL(url)
            }}
            disabled={!content}
            className="flex items-center rounded-lg p-[6px] bg-secondary hover:bg-muted disabled:opacity-30 transition-colors"
            title="Download"
          >
            <span className="material-icon text-foreground" style={{ fontSize: 16 }}>download</span>
          </button>
          {!isBinaryType(viewerType) && viewerType !== 'unsupported' && (
            <button
              onClick={() => {
                if (content) navigator.clipboard.writeText(content)
              }}
              disabled={!content}
              className="flex items-center rounded-lg p-[6px] bg-secondary hover:bg-muted disabled:opacity-30 transition-colors"
              title="Copy to clipboard"
            >
              <span className="material-icon text-foreground" style={{ fontSize: 16 }}>content_copy</span>
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden bg-card">
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="material-icon text-muted-foreground mb-2" style={{ fontSize: 32 }}>error</span>
            <p className="font-secondary text-[13px] text-muted-foreground">{error}</p>
          </div>
        ) : content !== null ? (
          <Suspense fallback={<LoadingSpinner />}>
            {viewerType === 'code' || viewerType === 'text' ? (
              <CodeViewer
                content={content}
                filename={filename}
                filePath={filePath}
                onContentChange={handleContentChange}
              />
            ) : viewerType === 'markdown' ? (
              <MarkdownViewer
                content={content}
                filename={filename}
                filePath={filePath}
                onContentChange={handleContentChange}
              />
            ) : viewerType === 'image' ? (
              <ImageViewer content={content} filename={filename} mimeType={mimeType} />
            ) : viewerType === 'pdf' ? (
              <PdfViewer content={content} filename={filename} />
            ) : viewerType === 'docx' ? (
              <DocxViewer content={content} filename={filename} />
            ) : viewerType === 'xlsx' ? (
              <XlsxViewer content={content} filename={filename} />
            ) : viewerType === 'pptx' ? (
              <PptxViewer content={content} filename={filename} />
            ) : (
              <UnsupportedViewer filename={filename} size={fileSize} />
            )}
          </Suspense>
        ) : null}
      </div>
    </div>
  )
})
