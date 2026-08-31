import React from 'react'

export type RouteNavigationLease = {
  isCurrent: () => boolean
}

/**
 * Captures the route and component lifetime that authorized an async action.
 * A later action, route change, or unmount revokes the lease, so a late async
 * completion cannot navigate away from the page the user is currently using.
 */
export function useRouteNavigationLease(): () => RouteNavigationLease {
  const mountedRef = React.useRef(true)
  const generationRef = React.useRef(0)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  return React.useCallback(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    const route = typeof window === 'undefined'
      ? ''
      : `${window.location.pathname}${window.location.search}${window.location.hash}`

    return {
      isCurrent: () => {
        if (!mountedRef.current || generationRef.current !== generation) return false
        if (typeof window === 'undefined') return route === ''
        return `${window.location.pathname}${window.location.search}${window.location.hash}` === route
      },
    }
  }, [])
}
