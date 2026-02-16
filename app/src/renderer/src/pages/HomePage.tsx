import { memo, useState, useCallback } from 'react'
import { useAppStore } from '../stores/useAppStore'
import ChatInput from '../components/ChatInput'
import SuggestionCard from '../components/SuggestionCard'
import PageShell from '../components/PageShell'

const allSuggestions = [
  'Search the web for the latest AI breakthroughs',
  'Connect your tools',
  'Try saving an article',
  'Create a scheduled task',
  'Create a site',
  'Summarize a long document',
  'Help me write an email',
  'Brainstorm project ideas',
  'Explain a complex topic',
  'Find and organize my notes',
]

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const VISIBLE_COUNT = 5

type HomePageProps = {
  onSend: () => void
  disabled: boolean
}

export default memo(function HomePage({ onSend, disabled }: HomePageProps) {
  const input = useAppStore((s) => s.input)
  const setInput = useAppStore((s) => s.setInput)

  const [hidden, setHidden] = useState(false)
  const [visibleSuggestions, setVisibleSuggestions] = useState(() =>
    allSuggestions.slice(0, VISIBLE_COUNT)
  )
  const [shuffleKey, setShuffleKey] = useState(0)

  const handleShuffle = useCallback(() => {
    setVisibleSuggestions(shuffleArray(allSuggestions).slice(0, VISIBLE_COUNT))
    setShuffleKey((k) => k + 1)
  }, [])

  return (
    <PageShell>
      <div className="flex flex-col items-center justify-center h-full px-6">
        <div className="w-full max-w-[700px] flex flex-col gap-5">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={onSend}
            disabled={disabled}
            variant="home"
          />
          {/* Suggestions — header always visible, cards collapse */}
          <div className="border border-border rounded-[14px] overflow-hidden bg-card">
            {/* Header: always visible */}
            <div className="flex items-center justify-between h-10 px-4">
              <span
                className="text-muted-dim font-secondary text-[13px] font-medium cursor-pointer hover:text-muted transition-colors"
                onClick={() => setHidden((h) => !h)}
              >
                {hidden ? 'Show Suggestions' : 'Hide'}
              </span>
              <button
                className="text-muted-dim hover:text-muted transition-colors"
                onClick={handleShuffle}
              >
                <span className="material-icon" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>
            {/* Cards: collapsible via grid row animation */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: hidden ? '0fr' : '1fr',
                transition: 'grid-template-rows 300ms ease-out',
              }}
            >
              <div style={{ overflow: 'hidden' }}>
                <div key={shuffleKey}>
                  {visibleSuggestions.map((text, i) => (
                    <SuggestionCard
                      key={text}
                      text={text}
                      onClick={(t) => setInput(t)}
                      animationDelay={i * 50}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
})
