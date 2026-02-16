import { useState, useMemo, memo } from 'react'
import * as XLSX from 'xlsx'
import DOMPurify from 'dompurify'

type XlsxViewerProps = {
  content: string
  filename: string
}

export default memo(function XlsxViewer({ content, filename }: XlsxViewerProps) {
  const workbook = useMemo(() => {
    const binary = atob(content)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return XLSX.read(bytes.buffer, { sheetRows: 500 })
  }, [content])

  const [activeSheet, setActiveSheet] = useState(0)

  const tableHtml = useMemo(() => {
    const sheetName = workbook.SheetNames[activeSheet]
    if (!sheetName) return ''
    const ws = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_html(ws, { id: 'xlsx-table' })
    return DOMPurify.sanitize(raw)
  }, [workbook, activeSheet])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="font-secondary text-[12px] text-muted-foreground">
          {workbook.SheetNames.length} sheet{workbook.SheetNames.length > 1 ? 's' : ''}
        </span>
        {workbook.SheetNames.length > 1 && (
          <div className="flex items-center gap-1">
            {workbook.SheetNames.map((name, i) => (
              <button
                key={name}
                onClick={() => setActiveSheet(i)}
                className={`px-2.5 py-1 rounded-md font-secondary text-[12px] font-medium transition-colors ${
                  i === activeSheet
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <div
          className="xlsx-preview"
          dangerouslySetInnerHTML={{ __html: tableHtml }}
        />
      </div>
    </div>
  )
})
