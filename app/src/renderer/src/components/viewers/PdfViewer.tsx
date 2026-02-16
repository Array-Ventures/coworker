import { useState, useMemo, memo } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'

// Use local worker file via import.meta.url — requires worker-src 'self' blob: in CSP
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type PdfViewerProps = {
  content: string
  filename: string
}

export default memo(function PdfViewer({ content, filename }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState(1)

  // Memoize binary data to avoid re-decoding on every render
  const fileData = useMemo(() => ({
    data: Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
  }), [content])

  return (
    <div className="flex flex-col h-full">
      {/* PDF toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="font-secondary text-[12px] text-muted-foreground">
          {numPages > 0 ? `${numPages} page${numPages > 1 ? 's' : ''}` : ''}
        </span>
        {numPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="flex items-center rounded-lg p-[6px] bg-secondary disabled:opacity-30"
            >
              <span className="material-icon text-foreground" style={{ fontSize: 16 }}>chevron_left</span>
            </button>
            <span className="font-secondary text-[12px] text-foreground font-medium min-w-[60px] text-center">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className="flex items-center rounded-lg p-[6px] bg-secondary disabled:opacity-30"
            >
              <span className="material-icon text-foreground" style={{ fontSize: 16 }}>chevron_right</span>
            </button>
          </div>
        )}
      </div>

      {/* PDF content */}
      <div className="flex-1 overflow-auto flex justify-center py-6 bg-background">
        <Document
          file={fileData}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={
            <div className="flex items-center justify-center py-16">
              <span className="material-icon text-muted-foreground animate-spin" style={{ fontSize: 24 }}>progress_activity</span>
            </div>
          }
          error={
            <div className="flex flex-col items-center justify-center py-16">
              <span className="material-icon text-muted-foreground mb-2" style={{ fontSize: 32 }}>error</span>
              <p className="font-secondary text-[13px] text-muted-foreground">Failed to load PDF</p>
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            renderTextLayer={false}
            renderAnnotationLayer
            className="shadow-lg"
          />
        </Document>
      </div>
    </div>
  )
})
