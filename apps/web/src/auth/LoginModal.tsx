import { LoginOverlay } from './LoginOverlay'

export interface LoginModalProps {
  opened: boolean
  onClose: () => void
}

/** 历史命名保留：现渲染全屏视频背景登录覆盖层（LoginOverlay）。 */
export function LoginModal({ opened, onClose }: LoginModalProps): JSX.Element {
  return <LoginOverlay opened={opened} onClose={onClose} />
}
