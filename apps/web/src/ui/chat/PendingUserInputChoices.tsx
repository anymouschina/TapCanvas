import React from 'react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'

export type PendingUserInputOption = Readonly<{
  label: string
  description?: string
  imageUrl?: string
  thumbnailUrl?: string
  preview?: string
}>

export type PendingUserInputQuestion = Readonly<{
  id: string
  header: string
  question: string
  options: readonly PendingUserInputOption[]
}>

export type PendingUserInputRequest = Readonly<{
  requestId: string
  questions: readonly PendingUserInputQuestion[]
}>

export type PendingUserInputAnswer = Readonly<{
  id: string
  value: string
  optionLabel: string
  optionIndex: number
}>

type PendingUserInputChoicesProps = Readonly<{
  request: PendingUserInputRequest
  disabled?: boolean
  onSubmit: (response: Readonly<{
    requestId: string
    answers: PendingUserInputAnswer[]
  }>) => void
}>

function optionText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function PendingUserInputChoices({
  request,
  disabled = false,
  onSubmit,
}: PendingUserInputChoicesProps): JSX.Element {
  const [answersByQuestionId, setAnswersByQuestionId] = React.useState<Readonly<Record<string, PendingUserInputAnswer>>>({})

  React.useEffect(() => {
    setAnswersByQuestionId({})
  }, [request.requestId])

  const orderedAnswers = React.useMemo(
    () => request.questions.flatMap((question) => {
      const answer = answersByQuestionId[question.id]
      return answer ? [answer] : []
    }),
    [answersByQuestionId, request.questions],
  )
  const allQuestionsAnswered = request.questions.length > 0
    && orderedAnswers.length === request.questions.length

  const selectOption = React.useCallback((questionId: string, option: PendingUserInputOption, optionIndex: number) => {
    const label = optionText(option.label)
    if (!label || disabled) return
    setAnswersByQuestionId((current) => ({
      ...current,
      [questionId]: {
        id: questionId,
        value: label,
        optionLabel: label,
        optionIndex,
      },
    }))
  }, [disabled])

  const submitAnswers = React.useCallback(() => {
    if (disabled || !allQuestionsAnswered) return
    onSubmit({
      requestId: request.requestId,
      answers: orderedAnswers,
    })
  }, [allQuestionsAnswered, disabled, onSubmit, orderedAnswers, request.requestId])

  return (
    <div className="tc-ai-chat-bubble__choices">
      {request.questions.map((question) => {
        const selectedAnswer = answersByQuestionId[question.id]
        const hasImages = question.options.some((option) => Boolean(optionText(option.imageUrl)))
        return (
          <div key={question.id} className="tc-ai-chat-bubble__choice-group">
            <div className="tc-ai-chat-bubble__choice-heading">
              {question.header ? (
                <span className="tc-ai-chat-bubble__choice-header">{question.header}</span>
              ) : null}
              {question.question ? (
                <span className="tc-ai-chat-bubble__choice-group-label">{question.question}</span>
              ) : null}
            </div>
            <div className={hasImages ? 'tc-ai-chat-bubble__choice-image-grid' : 'tc-ai-chat-bubble__choice-list'}>
              {question.options.map((option, optionIndex) => {
                const optionLabel = optionText(option.label)
                const optionDescription = optionText(option.description)
                const imageUrl = optionText(option.imageUrl)
                const previewUrl = optionText(option.thumbnailUrl) || optionText(option.preview) || imageUrl
                const selected = selectedAnswer?.optionIndex === optionIndex
                const buttonClassName = hasImages
                  ? `tc-ai-choice-card${selected ? ' tc-ai-choice-card--selected' : ''}`
                  : `tc-ai-choice-btn${selected ? ' tc-ai-choice-btn--selected' : ''}`
                return (
                  <button
                    key={`${optionIndex}_${optionLabel}`}
                    type="button"
                    className={buttonClassName}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => selectOption(question.id, option, optionIndex)}
                  >
                    {hasImages && imageUrl ? (
                      <ManagedImage
                        className="tc-ai-choice-card__image"
                        src={previewUrl}
                        alt={optionLabel}
                        priority="visible"
                      />
                    ) : null}
                    <span className={hasImages ? 'tc-ai-choice-card__label' : 'tc-ai-choice-btn__label'}>{optionLabel}</span>
                    {optionDescription ? (
                      <span className={hasImages ? 'tc-ai-choice-card__desc' : 'tc-ai-choice-btn__desc'}>{optionDescription}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <p className="tc-ai-choice-btn-hint">如果您有其他想法，也可以直接告诉我。</p>
          </div>
        )
      })}
      <div className="tc-ai-chat-bubble__choice-submit-row">
        <span className="tc-ai-chat-bubble__choice-progress" aria-live="polite">
          已选择 {orderedAnswers.length}/{request.questions.length}
        </span>
        <button
          type="button"
          className="tc-ai-chat-bubble__choice-submit"
          disabled={disabled || !allQuestionsAnswered}
          onClick={submitAnswers}
        >
          确认并继续
        </button>
      </div>
    </div>
  )
}
