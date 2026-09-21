// @vitest-environment jsdom
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoSubmissionInput } from './VideoSubmissionInput'
vi.mock('../../../../domain/resource-runtime', () => ({ ManagedImage: ({ alt }: { alt: string }) => <span>{alt}</span> }))

describe('submission record disclosure', () => {
  it('keeps history out of the editor until requested', async () => {
    render(<MantineProvider><VideoSubmissionInput value={{ prompt: '原始提交正文', referenceMediaManifest: { images: [{ url: 'https://example.com/image', label: '教室' }] } }} /></MantineProvider>)
    expect(screen.queryByText('原始提交正文')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '提交记录' }))
    expect(await screen.findByText('原始提交正文')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
