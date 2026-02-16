import { useState, useCallback, useMemo, memo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { python } from '@codemirror/lang-python'
import { EditorView } from '@codemirror/view'
import { uploadWorkspaceFile } from '../../mastra-client'

type CodeViewerProps = {
  content: string
  filename: string
  filePath: string
  onContentChange?: (content: string) => void
}

function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js': case 'jsx':
      return javascript({ jsx: true })
    case 'ts': case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'json':
      return json()
    case 'md':
      return markdown()
    case 'html':
      return html()
    case 'css':
      return css()
    case 'py':
      return python()
    default:
      return null
  }
}

export default memo(function CodeViewer({ content, filename, filePath, onContentChange }: CodeViewerProps) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const langExt = useMemo(() => getLanguageExtension(filename), [filename])

  const extensions = useMemo(() => {
    const exts = [EditorView.lineWrapping]
    if (langExt) exts.push(langExt)
    return exts
  }, [langExt])

  const handleEdit = useCallback(() => {
    setEditing(true)
    setEditContent(content)
    setSaved(false)
  }, [content])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setEditContent(content)
    setSaved(false)
  }, [content])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const dir = filePath.substring(0, filePath.lastIndexOf('/'))
      await uploadWorkspaceFile(dir, filename, editContent, 'utf-8')
      setEditing(false)
      setSaved(true)
      onContentChange?.(editContent)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [editContent, filePath, filename, onContentChange])

  return (
    <div className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border">
        {saved && (
          <span className="font-secondary text-[12px] text-green-500 flex items-center gap-1">
            <span className="material-icon" style={{ fontSize: 14 }}>check</span>
            Saved
          </span>
        )}
        {editing ? (
          <>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-secondary text-[12px] font-medium text-foreground bg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-secondary text-[12px] font-semibold text-primary-foreground bg-primary disabled:opacity-50"
            >
              <span className="material-icon" style={{ fontSize: 14 }}>save</span>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : (
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-secondary text-[12px] font-medium text-foreground bg-secondary"
          >
            <span className="material-icon" style={{ fontSize: 14 }}>edit</span>
            Edit
          </button>
        )}
      </div>

      {/* Code editor */}
      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={editing ? editContent : content}
          onChange={editing ? setEditContent : undefined}
          readOnly={!editing}
          extensions={extensions}
          theme="none"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: editing,
            highlightSelectionMatches: true,
          }}
          className="codemirror-viewer"
        />
      </div>
    </div>
  )
})
