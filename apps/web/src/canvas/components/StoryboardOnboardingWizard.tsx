import React from 'react'
import {
  Modal,
  Button,
  Text,
  Group,
  Stack,
  Progress,
  Box,
} from '@mantine/core'
import { IconArrowLeft, IconArrowRight, IconSparkles } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { hostedAssetUrl } from '../../config/objectStorageAssets'
import { sanitizeGraphForCanvas, useRFStore } from '../store'
import { getQuickStartSampleFlow } from '../quickStartSample'

const STEP_IMAGES: Partial<Record<string, string>> = {
  step1: hostedAssetUrl('uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/191f38c4-12a9-4f5c-ae9f-85c2fd0c421e.png'),
  step2: hostedAssetUrl('uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/1e3a3d64-fd07-439c-a3e3-cf896e8da98c.png'),
  step3: hostedAssetUrl('uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/3415c673-93b1-43d4-952e-5fd2ce57fa9d.png'),
  step4: hostedAssetUrl('uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/a7673fbb-93da-4e81-a3da-846642734a78.png'),
  step5: hostedAssetUrl('uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260510/578069cb-3663-415b-8ee4-43f587430ceb.png'),
}

type Step = {
  title: string
  desc: string
  imageKey: string
  hint: string
}

const STEPS: Step[] = [
  {
    title: '第一步：新建文本节点，替换文本',
    desc: '点击「开始创作」后画布会自动新建一个文本节点。将节点内的占位文字替换为你的剧本/小说内容，一句话梗概或几段正文都可以。',
    imageKey: 'step1',
    hint: '示例：深夜便利店，女主角推门而入，发现门外有一辆停下的黑车在等她……',
  },
  {
    title: '第二步：生成场景 & 角色卡',
    desc: '输入完文本后，点击节点上的「生成场景 & 角色卡」。AI 会自动提炼场景卡（含镜头/环境描述）和角色卡（含人物外貌），你可以编辑或删除任意卡片。',
    imageKey: 'step2',
    hint: '场景卡和角色卡是故事板的素材库，后续每一帧都会引用它们。',
  },
  {
    title: '第三步：场景 & 角色卡效果',
    desc: '生成完成后，画布上会出现一组场景卡与角色卡节点。你可以自由调整布局、编辑内容，也可以继续追加场景。',
    imageKey: 'step3',
    hint: '卡片内容越详细，后续分镜的镜头质量越高。',
  },
  {
    title: '第四步：点击生成故事板',
    desc: '确认场景卡后，点击「生成故事板」。AI 会将场景卡组合成连续分镜，每格包含镜头语言、角色动作和情绪变化。',
    imageKey: 'step4',
    hint: '默认生成 4 格分镜；可在节点设置中调整格数和画幅比例。',
  },
  {
    title: '第五步：故事板效果',
    desc: '故事板生成完成！每格分镜保持场景连贯性，可直接用于拍摄参考，或进一步生成分镜图。',
    imageKey: 'step5',
    hint: '生成的分镜图会自动存储为资产，可拖拽复用到其他节点。',
  },
]

type Props = {
  opened: boolean
  onClose: () => void
}

export function StoryboardOnboardingWizard({ opened, onClose }: Props) {
  const [step, setStep] = React.useState(0)
  const importWorkflow = useRFStore((s) => s.importWorkflow)

  function handleFinish() {
    const flow = getQuickStartSampleFlow('storyboard-sequence')
    importWorkflow(sanitizeGraphForCanvas(flow))
    onClose()
  }

  function handleClose() {
    setStep(0)
    onClose()
  }

  const current = STEPS[step]!
  const imgSrc = current ? STEP_IMAGES[current.imageKey] : undefined
  const isLast = step === STEPS.length - 1

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      size="xl"
      title={null}
      padding={0}
      radius="lg"
      classNames={{
        content: 'storyboard-wizard__modal-content',
        body: 'storyboard-wizard__modal-body',
      }}
      overlayProps={{ backgroundOpacity: 0.65, blur: 4 }}
    >
      <div className="storyboard-wizard">
        <div className="storyboard-wizard__progress-bar">
          <Progress
            value={((step + 1) / STEPS.length) * 100}
            size="xs"
            radius={0}
            color="orange"
            className="storyboard-wizard__progress"
          />
        </div>

        <div className="storyboard-wizard__image-area">
          {imgSrc ? (
            <ManagedImage
              className="storyboard-wizard__image"
              src={imgSrc}
              alt={current.title}
            />
          ) : (
            <div className="storyboard-wizard__image-placeholder">
              <IconSparkles size={48} stroke={1} opacity={0.3} />
            </div>
          )}
        </div>

        <Stack className="storyboard-wizard__content" gap="md" p="xl">
          <div>
            <Text className="storyboard-wizard__step-label" size="xs" c="dimmed" mb={4}>
              {step + 1} / {STEPS.length}
            </Text>
            <Text className="storyboard-wizard__title" size="xl" fw={700} lh={1.3}>
              {current.title}
            </Text>
          </div>

          <Text className="storyboard-wizard__desc" size="sm" c="dimmed" lh={1.7}>
            {current.desc}
          </Text>

          <Box className="storyboard-wizard__hint-box">
            <Text className="storyboard-wizard__hint" size="xs" c="dimmed" fs="italic">
              {current.hint}
            </Text>
          </Box>

          <Group className="storyboard-wizard__nav" justify="space-between" mt="auto">
            <Button
              className="storyboard-wizard__btn-prev"
              variant="subtle"
              color="gray"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
            >
              上一步
            </Button>

            {isLast ? (
              <Button
                className="storyboard-wizard__btn-finish"
                color="orange"
                rightSection={<IconSparkles size={14} />}
                onClick={handleFinish}
              >
                开始创作
              </Button>
            ) : (
              <Button
                className="storyboard-wizard__btn-next"
                rightSection={<IconArrowRight size={14} />}
                onClick={() => setStep((s) => s + 1)}
              >
                下一步
              </Button>
            )}
          </Group>
        </Stack>
      </div>
    </Modal>
  )
}
