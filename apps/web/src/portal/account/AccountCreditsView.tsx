import React from 'react'
import { Button, Loader } from '@mantine/core'
import {
  listAccountCredits,
  type AccountCreditEntry,
  type AccountCreditsPage,
} from '../accountApi'

type CreditEntryTone = 'credit' | 'deduct' | 'reserve' | 'release' | 'expire' | 'neutral'

export type CreditEntryPresentation = {
  label: string
  amountText: string
  tone: CreditEntryTone
  explanation: string | null
}

const creditNumber = new Intl.NumberFormat('zh-CN')

function formatCreditAmount(amount: number): string {
  return creditNumber.format(Math.max(0, Math.trunc(amount)))
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : value
}

export function presentCreditEntry(entry: Pick<AccountCreditEntry, 'type' | 'amount' | 'settlesReservation'>): CreditEntryPresentation {
  const amount = formatCreditAmount(entry.amount)
  switch (entry.type) {
    case 'reserve':
      return {
        label: '冻结积分',
        amountText: `冻结 ${amount}`,
        tone: 'reserve',
        explanation: '预占额度，不是实际扣减',
      }
    case 'deduct':
      return {
        label: '扣减积分',
        amountText: `−${amount}`,
        tone: 'deduct',
        explanation: entry.settlesReservation
          ? '由冻结额度结算，可用积分不会重复减少'
          : '直接扣减',
      }
    case 'release':
      return {
        label: '解冻积分',
        amountText: `解冻 ${amount}`,
        tone: 'release',
        explanation: '冻结额度已恢复可用',
      }
    case 'expire':
      return {
        label: '积分到期',
        amountText: `−${amount}`,
        tone: 'expire',
        explanation: null,
      }
    case 'topup':
      return { label: '积分入账', amountText: `+${amount}`, tone: 'credit', explanation: null }
    case 'referral_bonus':
    case 'referral_welcome':
    case 'checkin':
    case 'membership_monthly':
    case 'membership_daily':
      return { label: '奖励积分', amountText: `+${amount}`, tone: 'credit', explanation: null }
    default:
      return { label: entry.type, amountText: amount, tone: 'neutral', explanation: null }
  }
}

function CreditSummary({ page }: { page: AccountCreditsPage }): JSX.Element {
  return (
    <div className="account-credits-summary" aria-label="当前积分余额">
      <div className="account-credits-summary__primary">
        <span className="account-credits-summary__label">可用积分</span>
        <strong className="account-credits-summary__value">{creditNumber.format(page.creditsAvailable)}</strong>
      </div>
      <div className="account-credits-summary__metric account-credits-summary__metric--frozen">
        <span className="account-credits-summary__metric-label">冻结积分</span>
        <strong className="account-credits-summary__metric-value">{creditNumber.format(page.creditsFrozen)}</strong>
      </div>
      <div className="account-credits-summary__metric">
        <span className="account-credits-summary__metric-label">积分总额</span>
        <strong className="account-credits-summary__metric-value">{creditNumber.format(page.creditsTotal)}</strong>
      </div>
    </div>
  )
}

function CreditLedgerRow({ entry }: { entry: AccountCreditEntry }): JSX.Element {
  const presentation = presentCreditEntry(entry)
  return (
    <article className={`account-credit-row account-credit-row--${presentation.tone}`}>
      <div className="account-credit-row__main">
        <div className="account-credit-row__heading">
          <span className="account-credit-row__badge">{presentation.label}</span>
          <strong className="account-credit-row__type">{entry.note || entry.taskKind || entry.type}</strong>
        </div>
        <div className="account-credit-row__meta">
          <time className="account-credit-row__time">{formatTime(entry.createdAt)}</time>
          {presentation.explanation ? <span className="account-credit-row__explanation">{presentation.explanation}</span> : null}
        </div>
      </div>
      <strong className="account-credit-row__amount">{presentation.amountText}</strong>
      <div className="account-credit-row__balance">
        <span className="account-credit-row__balance-label">记录后可用积分</span>
        <strong className="account-credit-row__balance-value">{creditNumber.format(entry.creditsAvailableAfter)}</strong>
        <span className="account-credit-row__balance-meta">
          总额 {creditNumber.format(entry.creditsTotalAfter)} · 冻结 {creditNumber.format(entry.creditsFrozenAfter)}
        </span>
      </div>
    </article>
  )
}

export function AccountCreditsView(): JSX.Element {
  const [items, setItems] = React.useState<AccountCreditEntry[]>([])
  const [page, setPage] = React.useState<AccountCreditsPage | null>(null)
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null)
  const loadSequenceRef = React.useRef(0)

  const load = React.useCallback(async (nextCursor: string | null = null) => {
    const requestId = ++loadSequenceRef.current
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    if (nextCursor) setLoadMoreError(null)
    else setError(null)
    try {
      const nextPage = await listAccountCredits(nextCursor)
      if (requestId !== loadSequenceRef.current) return
      setItems((current) => nextCursor ? [...current, ...nextPage.items] : nextPage.items)
      setPage(nextPage)
      setCursor(nextPage.nextCursor)
    } catch (reason: unknown) {
      if (requestId !== loadSequenceRef.current) return
      const message = reason instanceof Error ? reason.message : '加载积分账单失败'
      if (nextCursor) setLoadMoreError(message)
      else setError(message)
    } finally {
      if (requestId === loadSequenceRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  React.useEffect(() => {
    void load()
    return () => { loadSequenceRef.current += 1 }
  }, [load])

  if (loading) {
    return <div className="account-center-state"><Loader className="account-center-state__loader" size="sm" /></div>
  }
  if (error || !page) {
    return (
      <div className="account-center-state account-center-state--error">
        <span className="account-center-state__message">{error || '积分账单响应缺少余额数据'}</span>
        <Button className="account-center-state__retry" variant="subtle" onClick={() => void load()}>重试</Button>
      </div>
    )
  }

  return (
    <div className="account-credits-view">
      <CreditSummary page={page} />
      {items.length === 0 ? (
        <div className="account-center-state"><span className="account-center-state__message">暂无积分记录</span></div>
      ) : (
        <div className="account-credit-list">{items.map((entry) => <CreditLedgerRow entry={entry} key={entry.id} />)}</div>
      )}
      {loadMoreError ? (
        <div className="account-center-page-error">
          <span className="account-center-page-error__message">{loadMoreError}</span>
          <Button className="account-center-page-error__retry" variant="subtle" onClick={() => void load(cursor)}>重试</Button>
        </div>
      ) : null}
      {cursor && !loadMoreError ? (
        <Button className="account-center-load-more" variant="subtle" loading={loadingMore} onClick={() => void load(cursor)}>加载更多</Button>
      ) : null}
    </div>
  )
}
