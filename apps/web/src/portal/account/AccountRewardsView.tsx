import React from 'react'
import { ActionIcon, Button, CopyButton, Loader, Tooltip } from '@mantine/core'
import { IconCheck, IconCopy, IconGift, IconRefresh, IconUsers } from '@tabler/icons-react'
import {
  getMyReferral,
  getReferralCampaign,
  getReferralStats,
  type MyReferralDto,
  type ReferralCampaignDto,
  type ReferralStatsDto,
} from '../../api/server'
import { toast } from '../../ui/toast'
import {
  getAccountCheckIn,
  performAccountCheckIn,
  type AccountCheckIn,
} from '../accountApi'

type AccountRewardsViewProps = {
  guestRestricted: boolean
  initialCheckIn: AccountCheckIn | null
  onCheckInChanged: (checkIn: AccountCheckIn) => void
}

type ReferralViewData = {
  campaign: ReferralCampaignDto
  referral: MyReferralDto
  stats: ReferralStatsDto
}

function frontendInviteUrl(referral: MyReferralDto): string {
  const code = referral.inviteCode.trim()
  if (!code || typeof window === 'undefined') return referral.inviteUrl
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`
}

export function AccountRewardsView({
  guestRestricted,
  initialCheckIn,
  onCheckInChanged,
}: AccountRewardsViewProps): JSX.Element {
  const [checkIn, setCheckIn] = React.useState<AccountCheckIn | null>(initialCheckIn)
  const [checkInLoading, setCheckInLoading] = React.useState(!guestRestricted && !initialCheckIn)
  const [checkInError, setCheckInError] = React.useState<string | null>(null)
  const [checkingIn, setCheckingIn] = React.useState(false)
  const [referralData, setReferralData] = React.useState<ReferralViewData | null>(null)
  const [referralLoading, setReferralLoading] = React.useState(!guestRestricted)
  const [referralError, setReferralError] = React.useState<string | null>(null)
  const checkInRequestRef = React.useRef(0)
  const referralRequestRef = React.useRef(0)

  const loadCheckIn = React.useCallback(async (): Promise<void> => {
    if (guestRestricted) return
    const requestId = ++checkInRequestRef.current
    setCheckInLoading(true)
    setCheckInError(null)
    try {
      const result = await getAccountCheckIn()
      if (requestId !== checkInRequestRef.current) return
      setCheckIn(result)
      onCheckInChanged(result)
    } catch (reason: unknown) {
      if (requestId !== checkInRequestRef.current) return
      setCheckInError(reason instanceof Error ? reason.message : '加载签到状态失败')
    } finally {
      if (requestId === checkInRequestRef.current) setCheckInLoading(false)
    }
  }, [guestRestricted, onCheckInChanged])

  const loadReferral = React.useCallback(async (): Promise<void> => {
    if (guestRestricted) return
    const requestId = ++referralRequestRef.current
    setReferralLoading(true)
    setReferralError(null)
    try {
      const [campaign, referral, stats] = await Promise.all([
        getReferralCampaign(),
        getMyReferral(),
        getReferralStats(),
      ])
      if (!referral.inviteCode.trim()) throw new Error('邀请服务未返回邀请码')
      if (requestId !== referralRequestRef.current) return
      setReferralData({ campaign, referral, stats })
    } catch (reason: unknown) {
      if (requestId !== referralRequestRef.current) return
      setReferralError(reason instanceof Error ? reason.message : '加载邀请信息失败')
    } finally {
      if (requestId === referralRequestRef.current) setReferralLoading(false)
    }
  }, [guestRestricted])

  React.useEffect(() => {
    if (!guestRestricted && !initialCheckIn) void loadCheckIn()
    return () => {
      checkInRequestRef.current += 1
    }
  }, [guestRestricted, initialCheckIn, loadCheckIn])

  React.useEffect(() => {
    void loadReferral()
    return () => {
      referralRequestRef.current += 1
    }
  }, [loadReferral])

  const submitCheckIn = React.useCallback(async (): Promise<void> => {
    setCheckingIn(true)
    setCheckInError(null)
    try {
      const result = await performAccountCheckIn()
      setCheckIn(result)
      onCheckInChanged(result)
      toast(result.awarded ? `签到成功，获得 ${result.rewardCredits} 积分` : '今日已签到', result.awarded ? 'success' : 'info')
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : '签到失败'
      setCheckInError(message)
      toast(message, 'error')
    } finally {
      setCheckingIn(false)
    }
  }, [onCheckInChanged])

  if (guestRestricted) {
    return (
      <div className="account-rewards-restricted">
        <IconGift className="account-rewards-restricted__icon" size={24} />
        <strong className="account-rewards-restricted__title">游客账号暂不能赚取积分</strong>
        <span className="account-rewards-restricted__description">请切换或添加正式账号后再签到、邀请好友。</span>
      </div>
    )
  }

  const inviteUrl = referralData ? frontendInviteUrl(referralData.referral) : ''
  const checkInUnavailable = !checkIn?.configured || !checkIn.enabled

  return (
    <div className="account-rewards-view">
      <section className="account-rewards-section">
        <div className="account-rewards-section__heading">
          <div className="account-rewards-section__copy">
            <strong className="account-rewards-section__title">每日签到</strong>
            <span className="account-rewards-section__description">
              {checkInUnavailable ? '当前未开放签到' : `每次签到获得 ${checkIn?.rewardCredits ?? 0} 积分`}
            </span>
          </div>
          <Button
            className="account-rewards-section__action"
            loading={checkingIn}
            disabled={checkInLoading || checkInUnavailable || checkIn?.checkedInToday}
            leftSection={<IconGift className="account-rewards-section__action-icon" size={15} />}
            onClick={() => void submitCheckIn()}
          >
            {checkIn?.checkedInToday ? '今日已签到' : '立即签到'}
          </Button>
        </div>
        {checkInLoading ? <div className="account-rewards-inline-state"><Loader className="account-rewards-inline-state__loader" size="xs" /></div> : null}
        {checkInError ? (
          <div className="account-rewards-inline-state account-rewards-inline-state--error" role="alert">
            <span className="account-rewards-inline-state__message">{checkInError}</span>
            <Tooltip className="account-rewards-inline-state__tooltip" label="重新加载">
              <ActionIcon className="account-rewards-inline-state__retry" variant="subtle" aria-label="重新加载签到状态" onClick={() => void loadCheckIn()}>
                <IconRefresh className="account-rewards-inline-state__retry-icon" size={14} />
              </ActionIcon>
            </Tooltip>
          </div>
        ) : null}
        {checkIn && !checkInLoading ? (
          <div className="account-rewards-metrics">
            <div className="account-rewards-metric"><span className="account-rewards-metric__label">累计签到</span><strong className="account-rewards-metric__value">{checkIn.cumulativeDays} 天</strong></div>
            <div className="account-rewards-metric"><span className="account-rewards-metric__label">当前积分</span><strong className="account-rewards-metric__value">{checkIn.balance}</strong></div>
          </div>
        ) : null}
      </section>

      <section className="account-rewards-section">
        <div className="account-rewards-section__heading">
          <div className="account-rewards-section__copy">
            <strong className="account-rewards-section__title">邀请好友</strong>
            <span className="account-rewards-section__description">
              {referralData?.campaign.enabled === false ? '邀请活动当前已暂停' : '分享你的专属链接，奖励按活动规则结算'}
            </span>
          </div>
          <IconUsers className="account-rewards-section__heading-icon" size={19} />
        </div>
        {referralLoading ? <div className="account-rewards-inline-state"><Loader className="account-rewards-inline-state__loader" size="xs" /></div> : null}
        {referralError ? (
          <div className="account-rewards-inline-state account-rewards-inline-state--error" role="alert">
            <span className="account-rewards-inline-state__message">{referralError}</span>
            <Button className="account-rewards-inline-state__retry-button" variant="subtle" size="compact-xs" leftSection={<IconRefresh size={13} />} onClick={() => void loadReferral()}>重试</Button>
          </div>
        ) : null}
        {referralData ? (
          <>
            <div className="account-rewards-invite-fields">
              <div className="account-rewards-invite-field">
                <span className="account-rewards-invite-field__label">邀请码</span>
                <strong className="account-rewards-invite-field__value">{referralData.referral.inviteCode}</strong>
                <CopyButton value={referralData.referral.inviteCode}>
                  {({ copied, copy }) => (
                    <Tooltip className="account-rewards-invite-field__tooltip" label={copied ? '已复制' : '复制邀请码'}>
                      <ActionIcon className="account-rewards-invite-field__copy" variant="subtle" aria-label="复制邀请码" onClick={copy}>
                        {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </div>
              <div className="account-rewards-invite-field">
                <span className="account-rewards-invite-field__label">邀请链接</span>
                <span className="account-rewards-invite-field__url">{inviteUrl}</span>
                <CopyButton value={inviteUrl}>
                  {({ copied, copy }) => (
                    <Tooltip className="account-rewards-invite-field__tooltip" label={copied ? '已复制' : '复制邀请链接'}>
                      <ActionIcon className="account-rewards-invite-field__copy" variant="subtle" aria-label="复制邀请链接" onClick={copy}>
                        {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </div>
            </div>
            <div className="account-rewards-metrics">
              <div className="account-rewards-metric"><span className="account-rewards-metric__label">已邀请</span><strong className="account-rewards-metric__value">{referralData.stats.inviteeCount} 人</strong></div>
              <div className="account-rewards-metric"><span className="account-rewards-metric__label">邀请所得</span><strong className="account-rewards-metric__value">{referralData.stats.totalGrantedCredits} 积分</strong></div>
            </div>
            <p className="account-rewards-rule">
              受邀好友注册后获得 {referralData.campaign.inviteeWelcomeCredits} 积分。
            </p>
          </>
        ) : null}
      </section>
    </div>
  )
}
