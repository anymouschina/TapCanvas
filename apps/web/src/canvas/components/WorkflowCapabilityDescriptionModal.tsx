import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { IconPlugConnected, IconSparkles } from '@tabler/icons-react'

type WorkflowCapabilityDescriptionModalProps = {
  opened: boolean
  workflowName: string
  description: string
  generating: boolean
  saving: boolean
  onClose: () => void
  onDescriptionChange: (value: string) => void
  onGenerate: () => void
  onConfirm: () => void
}

export function WorkflowCapabilityDescriptionModal({
  opened,
  workflowName,
  description,
  generating,
  saving,
  onClose,
  onDescriptionChange,
  onGenerate,
  onConfirm,
}: WorkflowCapabilityDescriptionModalProps): JSX.Element {
  return (
    <Modal
      className="workflow-capability-description-modal"
      opened={opened}
      onClose={onClose}
      title="装载工作流"
      centered
      size={640}
      closeButtonProps={{ 'aria-label': '关闭工作流能力说明' }}
      overlayProps={{ backgroundOpacity: 0.7, blur: 8 }}
      zIndex={10200}
    >
      <Stack className="workflow-capability-description-modal__content" gap="md">
        <Stack className="workflow-capability-description-modal__heading" gap={4}>
          <Text className="workflow-capability-description-modal__name" fw={700}>{workflowName}</Text>
          <Text className="workflow-capability-description-modal__hint" size="sm" c="dimmed">
            装载前先说明这个工作流何时适用、每次运行需要什么输入，以及最终交付什么。小T据此自主选择工作流；精确输入字段仍由工作流结构确定。
          </Text>
        </Stack>
        <Stack className="workflow-capability-description-modal__field" gap={8}>
          <Group className="workflow-capability-description-modal__label-row" justify="space-between" align="center">
            <Text className="workflow-capability-description-modal__label" fw={700}>工作流能力说明</Text>
            <Button
              className="workflow-capability-description-modal__generate"
              type="button"
              variant="subtle"
              size="compact-sm"
              radius="xs"
              leftSection={<IconSparkles className="workflow-capability-description-modal__generate-icon" size={14} />}
              loading={generating}
              disabled={saving}
              onClick={onGenerate}
            >
              智能生成
            </Button>
          </Group>
          <Textarea
            className="workflow-capability-description-modal__input"
            aria-label="工作流能力说明"
            value={description}
            onChange={(event) => onDescriptionChange(event.currentTarget.value)}
            placeholder="供小T判断何时调用：适用场景、本次输入与最终交付"
            minRows={6}
            maxRows={10}
            maxLength={1000}
            autosize
          />
        </Stack>
        <Group className="workflow-capability-description-modal__actions" justify="flex-end" gap="sm">
          <Button className="workflow-capability-description-modal__cancel" type="button" variant="subtle" color="gray" onClick={onClose} disabled={generating || saving}>取消</Button>
          <Button
            className="workflow-capability-description-modal__confirm"
            type="button"
            leftSection={<IconPlugConnected className="workflow-capability-description-modal__confirm-icon" size={15} />}
            loading={saving}
            disabled={generating || !description.trim()}
            onClick={onConfirm}
          >
            保存版本并检查装载
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
