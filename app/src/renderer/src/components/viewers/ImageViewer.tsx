import { useState, useCallback, useRef, memo } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'

type ImageViewerProps = {
  content: string
  filename: string
  mimeType?: string
}

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => zoomOut()}
        className="flex items-center rounded-lg p-[6px] bg-secondary"
      >
        <span className="material-icon text-foreground" style={{ fontSize: 16 }}>zoom_out</span>
      </button>
      <button
        onClick={() => resetTransform()}
        className="flex items-center rounded-lg px-2.5 py-[6px] bg-secondary font-secondary text-[12px] font-medium text-foreground"
      >
        Fit
      </button>
      <button
        onClick={() => zoomIn()}
        className="flex items-center rounded-lg p-[6px] bg-secondary"
      >
        <span className="material-icon text-foreground" style={{ fontSize: 16 }}>zoom_in</span>
      </button>
    </div>
  )
}

function ImageMeta({ dimensions, sizeStr }: { dimensions: { w: number; h: number } | null; sizeStr: string }) {
  return (
    <div className="flex items-center gap-3 font-secondary text-[12px] text-muted-foreground">
      {dimensions && <span>{dimensions.w} x {dimensions.h}</span>}
      {sizeStr && <span>{sizeStr}</span>}
    </div>
  )
}

export default memo(function ImageViewer({ content, filename, mimeType }: ImageViewerProps) {
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const ext = filename.split('.').pop()?.toLowerCase()
  const mime = mimeType || `image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext}`
  const dataUrl = `data:${mime};base64,${content}`

  const handleLoad = useCallback(() => {
    if (imgRef.current) {
      setDimensions({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
    }
  }, [])

  const sizeStr = content ? `${(content.length * 0.75 / 1024).toFixed(1)} KB` : ''

  return (
    <TransformWrapper
      initialScale={1}
      minScale={0.1}
      maxScale={10}
      centerOnInit
    >
      <div className="flex flex-col h-full">
        {/* Image toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <ImageMeta dimensions={dimensions} sizeStr={sizeStr} />
          <ZoomControls />
        </div>

        {/* Image content — checkerboard background for transparency */}
        <div className="flex-1 overflow-hidden bg-[repeating-conic-gradient(var(--color-muted-dim)_0%_25%,var(--color-card)_0%_50%)] bg-[length:20px_20px]">
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <img
              ref={imgRef}
              src={dataUrl}
              alt={filename}
              onLoad={handleLoad}
              className="max-w-full max-h-full object-contain"
              draggable={false}
            />
          </TransformComponent>
        </div>
      </div>
    </TransformWrapper>
  )
})
