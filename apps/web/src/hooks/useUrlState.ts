import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Filters, tabs, search and page live in the query string so views can be
 * bookmarked, shared and survive a refresh. Values equal to the default are
 * left out of the URL. Changing anything other than `page` resets to page 1.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams()

  const state = useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults)) {
      const v = params.get(key)
      if (v !== null) (out as Record<string, string>)[key] = v
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const set = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === defaults[k]) next.delete(k)
            else next.set(k, String(v))
          }
          if (!('page' in patch) && 'page' in defaults) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  )

  return [state, set] as const
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * A search box bound to a URL param: typing updates the input immediately and
 * the URL (and therefore the query) after a short debounce.
 */
export function useDebouncedUrlSearch(urlValue: string, commit: (v: string) => void, ms = 300) {
  const [text, setText] = useState(urlValue)
  // Keep the box in sync when the URL changes from elsewhere (e.g. back button).
  const [seenUrl, setSeenUrl] = useState(urlValue)
  if (urlValue !== seenUrl) {
    setSeenUrl(urlValue)
    setText(urlValue)
  }
  const debounced = useDebounced(text, ms)
  useEffect(() => {
    if (debounced !== urlValue) commit(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])
  return [text, setText] as const
}
