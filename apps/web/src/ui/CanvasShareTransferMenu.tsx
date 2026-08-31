import { ActionIcon, Menu } from '@mantine/core'
import {
  IconDeviceTv,
  IconDownload,
  IconLink,
  IconShare2,
  IconUpload,
} from '@tabler/icons-react'
import { $ } from '../canvas/i18n'

export type CanvasShareTransferMenuProps = Readonly<{
  onPublish: () => void
  onCopyShareLink: () => void
  onExportCanvas: () => void
  onImportCanvas: () => void
  onExportWorkflow: () => void
  onImportWorkflow: () => void
}>

export function CanvasShareTransferMenu({
  onPublish,
  onCopyShareLink,
  onExportCanvas,
  onImportCanvas,
  onExportWorkflow,
  onImportWorkflow,
}: CanvasShareTransferMenuProps) {
  return (
    <Menu
      className="app-share-transfer-menu"
      position="bottom-end"
      shadow="md"
      width={240}
      withArrow
      zIndex={400}
    >
      <Menu.Target>
        <ActionIcon
          className="app-publish-action"
          size="lg"
          variant="subtle"
          aria-label="发布、分享与导入导出"
          title="发布、分享与导入导出"
        >
          <IconShare2 className="app-publish-icon" size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className="app-share-transfer-menu__dropdown">
        <Menu.Label className="app-share-transfer-menu__label">发布与分享</Menu.Label>
        <Menu.Item
          className="app-share-transfer-menu__publish"
          leftSection={<IconDeviceTv className="app-share-transfer-menu__item-icon" size={16} />}
          onClick={onPublish}
        >
          发布作品
        </Menu.Item>
        <Menu.Item
          className="app-share-transfer-menu__share"
          leftSection={<IconLink className="app-share-transfer-menu__item-icon" size={16} />}
          onClick={onCopyShareLink}
        >
          分享链接
        </Menu.Item>
        <Menu.Divider className="app-share-transfer-menu__divider" />
        <Menu.Label className="app-share-transfer-menu__label">画布文件</Menu.Label>
        <Menu.Item
          className="app-canvas-export-item"
          leftSection={<IconDownload className="app-share-transfer-menu__item-icon" size={14} />}
          onClick={onExportCanvas}
        >
          {$('导出 JSON')}
        </Menu.Item>
        <Menu.Item
          className="app-canvas-import-item"
          leftSection={<IconUpload className="app-share-transfer-menu__item-icon" size={14} />}
          onClick={onImportCanvas}
        >
          {$('导入 JSON')}
        </Menu.Item>
        <Menu.Divider className="app-workflow-transfer-divider" />
        <Menu.Label className="app-share-transfer-menu__label">工作流</Menu.Label>
        <Menu.Item
          className="app-workflow-export-item"
          leftSection={<IconDownload className="app-share-transfer-menu__item-icon" size={14} />}
          onClick={onExportWorkflow}
        >
          导出选中工作流
        </Menu.Item>
        <Menu.Item
          className="app-workflow-import-item"
          leftSection={<IconUpload className="app-share-transfer-menu__item-icon" size={14} />}
          onClick={onImportWorkflow}
        >
          插入工作流
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
