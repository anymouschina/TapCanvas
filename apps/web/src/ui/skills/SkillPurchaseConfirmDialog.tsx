import { Loader, Modal } from '@mantine/core'
import { IconCoins, IconShoppingBag } from '@tabler/icons-react'
import type { SkillMarketplaceItemDto } from '../../api/server'
import { SkillLogo } from './SkillLogo'

type SkillPurchaseConfirmDialogProps = {
	opened: boolean
	item: SkillMarketplaceItemDto
	creditBalance: number
	purchasing: boolean
	onClose: () => void
	onConfirm: () => Promise<boolean>
}

export function SkillPurchaseConfirmDialog({
	opened,
	item,
	creditBalance,
	purchasing,
	onClose,
	onConfirm,
}: SkillPurchaseConfirmDialogProps): JSX.Element {
	const priceCredits = item.priceCredits ?? 0
	const remainingCredits = creditBalance - priceCredits
	const insufficientCredits = remainingCredits < 0

	return (
		<Modal
			className="tc-skill-confirm-dialog tc-skill-purchase-dialog"
			opened={opened}
			onClose={purchasing ? () => {} : onClose}
			title="购买技能"
			centered
			size="sm"
			zIndex={10300}
			closeButtonProps={{ disabled: purchasing, 'aria-label': '关闭购买确认' }}
			overlayProps={{ backgroundOpacity: 0.72, blur: 6 }}
			transitionProps={{ duration: 0 }}
		>
			<div className="tc-skill-confirm-dialog__body">
				<div className="tc-skill-confirm-dialog__skill">
					<SkillLogo className="tc-skill-confirm-dialog__logo" skill={item.skill} priority="visible" />
					<span className="tc-skill-confirm-dialog__skill-copy">
						<strong className="tc-skill-confirm-dialog__skill-name">{item.skill.name}</strong>
						<span className="tc-skill-confirm-dialog__skill-author">{item.sellerName || '未知创作者'}</span>
					</span>
				</div>

				<dl className="tc-skill-confirm-dialog__ledger" aria-label="积分支付明细">
					<div className="tc-skill-confirm-dialog__ledger-row">
						<dt className="tc-skill-confirm-dialog__ledger-label">技能价格</dt>
						<dd className="tc-skill-confirm-dialog__ledger-value tc-skill-confirm-dialog__ledger-value--price">{priceCredits} 积分</dd>
					</div>
					<div className="tc-skill-confirm-dialog__ledger-row">
						<dt className="tc-skill-confirm-dialog__ledger-label">当前可用</dt>
						<dd className="tc-skill-confirm-dialog__ledger-value">{creditBalance} 积分</dd>
					</div>
					<div className="tc-skill-confirm-dialog__ledger-row tc-skill-confirm-dialog__ledger-row--result">
						<dt className="tc-skill-confirm-dialog__ledger-label">支付后余额</dt>
						<dd className={`tc-skill-confirm-dialog__ledger-value${insufficientCredits ? ' is-insufficient' : ''}`}>{insufficientCredits ? `还差 ${Math.abs(remainingCredits)} 积分` : `${remainingCredits} 积分`}</dd>
					</div>
				</dl>

				<p className="tc-skill-confirm-dialog__rule">
					<IconCoins className="tc-skill-confirm-dialog__rule-icon" size={16} />
					<span className="tc-skill-confirm-dialog__rule-copy">本次交易仅使用站内积分。确认后技能将安装到“我的技能”；积分不支持提现或兑换现金。</span>
				</p>
				{insufficientCredits ? <p className="tc-skill-confirm-dialog__error" role="alert">积分不足，无法完成购买。</p> : null}
			</div>

			<footer className="tc-skill-confirm-dialog__footer">
				<button className="tc-skill-confirm-dialog__cancel" type="button" disabled={purchasing} onClick={onClose}>取消</button>
				<button className="tc-skill-confirm-dialog__confirm" type="button" disabled={purchasing || insufficientCredits} onClick={() => { void onConfirm() }}>
					{purchasing ? <Loader className="tc-skill-confirm-dialog__button-loader" size={14} color="dark" /> : <IconShoppingBag className="tc-skill-confirm-dialog__button-icon" size={15} />}
					<span className="tc-skill-confirm-dialog__button-label">{insufficientCredits ? '积分不足' : purchasing ? '购买中' : '确认购买'}</span>
				</button>
			</footer>
		</Modal>
	)
}
