import { memo } from 'react'

type UnsupportedViewerProps = {
  filename: string
  size?: number
}

export default memo(function UnsupportedViewer({ filename, size }: UnsupportedViewerProps) {
  const ext = filename.split('.').pop()?.toUpperCase() || 'Unknown'
  const sizeStr = size ? `${(size / 1024).toFixed(1)} KB` : ''

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="material-icon text-muted-foreground" style={{ fontSize: 56 }}>insert_drive_file</span>
        <div>
          <p className="font-secondary text-[15px] text-foreground font-medium">{filename}</p>
          <p className="font-secondary text-[13px] text-muted-foreground mt-1">
            .{ext} file{sizeStr ? ` · ${sizeStr}` : ''}
          </p>
        </div>
        <p className="font-secondary text-[13px] text-muted-foreground max-w-[280px]">
          This file type cannot be previewed. You can download it or use the agent to work with it.
        </p>
      </div>
    </div>
  )
})
