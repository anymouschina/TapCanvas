import React from 'react'
import { IconBrandGithub, IconMail } from '@tabler/icons-react'

export function PortalFooter(): JSX.Element {
  return (
    <footer className="neo-portal-footer">
      <nav className="neo-portal-footer__nav" aria-label="站点信息">
        <a
          className="neo-portal-footer__link"
          href="https://github.com/anymouschina/TapCanvas"
          target="_blank"
          rel="noreferrer"
        >
          <IconBrandGithub className="neo-portal-footer__link-icon" size={14} />
          源码仓库
        </a>
        <a className="neo-portal-footer__link" href="mailto:beq.li@qq.com">
          <IconMail className="neo-portal-footer__link-icon" size={14} />
          联系我们
        </a>
      </nav>
      <span className="neo-portal-footer__copyright">© 2026 TapCanvas. All rights reserved.</span>
    </footer>
  )
}
