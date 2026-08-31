import React from 'react'

/**
 * Loads a TaskNode feature behind a local Suspense boundary.
 *
 * The local boundary is intentional: letting the suspension reach TaskNodeCard
 * would replace the entire focused node with the overview shell while a panel
 * or kind-specific content module is loading.
 */
export function createLazyTaskNodeComponent<TProps extends object>(
  loader: () => Promise<{ default: React.FunctionComponent<TProps> }>,
): React.ComponentType<TProps> {
  const LazyComponent = React.lazy<React.FunctionComponent<TProps>>(loader)

  function AsyncTaskNodeComponent(props: TProps): React.JSX.Element {
    const lazyProps = props as React.JSX.IntrinsicAttributes & React.PropsWithRef<TProps>
    return (
      <React.Suspense fallback={null}>
        <LazyComponent {...lazyProps} />
      </React.Suspense>
    )
  }

  return AsyncTaskNodeComponent
}
