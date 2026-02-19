import { useEffect, useRef } from 'react'

/**
 * Call a Zustand slice's load function on component mount.
 *
 * The load function itself handles caching (SWR):
 * - If data is already loaded → returns instantly, revalidates in background
 * - If data is not loaded → awaits the fetch
 *
 * Uses a ref to avoid re-firing if the function reference changes,
 * and catches rejections to prevent unhandled promise errors.
 *
 * Usage in any page/component:
 *   const loadThreads = useAppStore(s => s.loadThreads)
 *   useSliceData(loadThreads)
 */
export function useSliceData(loadFn: () => Promise<void>) {
  const ref = useRef(loadFn)
  ref.current = loadFn
  useEffect(() => { ref.current().catch(() => {}) }, [])
}
