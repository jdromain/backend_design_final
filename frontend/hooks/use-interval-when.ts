import { useEffect, useRef } from "react"

/**
 * Calls `fn` every `ms` while `active` is true. Useful for lightweight polling
 * (e.g. document processing status) without full query-library setup.
 */
export function useIntervalWhen(active: boolean, fn: () => void, ms: number): void {
  const ref = useRef(fn)
  ref.current = fn

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      ref.current()
    }, ms)
    return () => clearInterval(id)
  }, [active, ms])
}
