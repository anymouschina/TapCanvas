import { Loader, Modal } from '@mantine/core'
import { IconAlertTriangle, IconShoppingBagMinus, IconTrash } from '@tabler/icons-react'
import type { UserContextAssetDto } from '../../api/server'

export type SkillActionConfirmKind = 'uninstall' | 'unlist'

type SkillActionConfirmDialogProps = {
	opened: boolean
	kind: SkillActionConfirmKind
	skill: UserContextAssetDto | null
	busy: boolean
	onClose: () => void
	onConfirm: () => Promise<boolean>
}

export function SkillActionConfirmDialog({
	opened,
	kind,
	skill,
	busy,
	onClose,
	onConfirm,
}: SkillActionConfirmDialogProps): JSX.Element {
	const uninstalling = kind === 'uninstall'
	const blockedByListing = uninstalling && Boolean(skill?.marketplaceListing)
	const title = uninstalling ? '卸载技能' : '下架技能'
	const confirmLabel = uninstalling ? '卸载' : '确认下架'

	return (
		<Modal
			className="tc-skill-confirm-dialog tc-skill-action-dialog"
			opened={opened}
			onClose={busy ? () => {} : onClose}
			title={title}
			centered
			size="sm"
			zIndex={10300}
			closeButtonProps={{ disabled: busy, 'aria-label': `关闭${title}确认` }}
			overlayProps={{ backgroundOpacity: 0.72, blur: 6 }}
			transitionProps={{ duration: 0 }}
		>
			<div className="tc-skill-confirm-dialog__body">
				<div className="tc-skill-confirm-dialog__warning">
					<IconAlertTriangle className="tc-skill-confirm-dialog__warning-icon" size={20} />
					<span className="tc-skill-confirm-dialog__warning-copy">
						<strong className="tc-skill-confirm-dialog__warning-title">{skill?.name || '当前技能'}</strong>
						<span className="tc-skill-confirm-dialog__warning-description">
							{blockedByListing
								? '该技能当前已上架，请先在“我的上架”中下架，再执行卸载。'
								: uninstalling
									? '卸载后将从“我的技能”中永久移除，且无法恢复。'
									: '下架后商城将停止新购买，已购买用户的使用权不受影响。'}
						</span>
					</span>
				</div>
			</div>

			<footer className="tc-skill-confirm-dialog__footer">
				<button className="tc-skill-confirm-dialog__cancel" type="button" disabled={busy} onClick={onClose}>取消</button>
				<button className="tc-skill-confirm-dialog__confirm tc-skill-confirm-dialog__confirm--danger" type="button" disabled={busy || blockedByListing || !skill} onClick={() => { void onConfirm() }}>
					{busy ? <Loader className="tc-skill-confirm-dialog__button-loader" size={14} color="white" /> : uninstalling ? <IconTrash className="tc-skill-confirm-dialog__button-icon" size={15} /> : <IconShoppingBagMinus className="tc-skill-confirm-dialog__button-icon" size={15} />}
					<span className="tc-skill-confirm-dialog__button-label">{blockedByListing ? '请先下架' : busy ? '处理中' : confirmLabel}</span>
				</button>
			</footer>
		</Modal>
	)
}
