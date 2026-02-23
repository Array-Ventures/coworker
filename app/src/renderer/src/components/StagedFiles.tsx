import { memo } from 'react'
import type { StagedFile } from '../types/harness'

type StagedFilesProps = {
  files: StagedFile[]
  onRemove: (index: number) => void
}

export default memo(function StagedFiles({ files, onRemove }: StagedFilesProps) {
  if (files.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto">
      {files.map((file, i) => (
        <div key={i} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-secondary">
          {file.mediaType.startsWith('image/') ? (
            <img
              src={file.url}
              alt={file.filename || 'image'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full gap-0.5">
              <span className="material-icon text-muted-dim" style={{ fontSize: 20 }}>
                description
              </span>
              <span className="text-muted-dim font-secondary text-[9px] font-medium px-1 truncate max-w-full">
                {file.filename || 'file'}
              </span>
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-destructive flex items-center justify-center hover:opacity-80 transition-opacity"
          >
            <span className="material-icon text-white" style={{ fontSize: 12 }}>close</span>
          </button>
        </div>
      ))}
    </div>
  )
})
