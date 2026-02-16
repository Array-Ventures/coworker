import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem('coworker-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'system'
}

function getResolvedDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark)
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getStoredTheme)
  const [isDark, setIsDark] = useState(() => getResolvedDark(getStoredTheme()))

  const setMode = useCallback((newMode: ThemeMode) => {
    if (newMode === 'system') {
      localStorage.removeItem('coworker-theme')
    } else {
      localStorage.setItem('coworker-theme', newMode)
    }
    setModeState(newMode)
    const dark = getResolvedDark(newMode)
    setIsDark(dark)
    applyTheme(dark)
  }, [])

  // Listen for system preference changes when in "system" mode
  useEffect(() => {
    if (mode !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      setIsDark(e.matches)
      applyTheme(e.matches)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  return { mode, isDark, setMode }
}
