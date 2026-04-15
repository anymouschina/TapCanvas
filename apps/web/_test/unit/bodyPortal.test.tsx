import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BodyPortal from '../../src/ui/BodyPortal'

describe('BodyPortal', () => {
  it('renders children into document.body', () => {
    render(
      <div className="body-portal-test-host">
        <BodyPortal>
          <div data-testid="body-portal-child">body portal child</div>
        </BodyPortal>
      </div>,
    )

    expect(screen.getByTestId('body-portal-child')).toBeInTheDocument()
    expect(document.body.textContent).toContain('body portal child')
  })
})
