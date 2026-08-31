import React from 'react'
import { ActionIcon, Box, Center, Divider, Group, ScrollArea, Stack, Text, Tooltip } from '@mantine/core'
import { IconCopy, IconMessages } from '@tabler/icons-react'
import type { PublicConversationMessageDto, PublicConversationSessionDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { toast } from './toast'

type PublicConversationPanelProps = {
  sessions: PublicConversationSessionDto[]
}

async function copyMessage(message: PublicConversationMessageDto): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.content)
    toast('已复制对话内容', 'success')
  } catch (error) {
    console.error('[public-conversation] copy message failed', error)
    toast('复制对话内容失败', 'error')
  }
}

export function PublicConversationPanel({ sessions }: PublicConversationPanelProps): JSX.Element {
  const messageCount = sessions.reduce((total, session) => total + session.messages.length, 0)

  return (
    <aside className="tc-share-conversation" aria-label="创作对话记录">
      <header className="tc-share-conversation__header">
        <Group className="tc-share-conversation__header-row" gap={10} wrap="nowrap">
          <IconMessages className="tc-share-conversation__header-icon" size={18} aria-hidden="true" />
          <div className="tc-share-conversation__header-copy">
            <Text className="tc-share-conversation__title" fw={600}>创作对话记录</Text>
            <Text className="tc-share-conversation__meta" size="xs" c="dimmed">
              只读 · {messageCount} 条消息
            </Text>
          </div>
        </Group>
      </header>

      {messageCount === 0 ? (
        <Center className="tc-share-conversation__empty">
          <Text className="tc-share-conversation__empty-text" size="sm" c="dimmed">暂无对话记录</Text>
        </Center>
      ) : (
        <ScrollArea className="tc-share-conversation__scroll" type="auto" scrollbarSize={8}>
          <Stack className="tc-share-conversation__sessions" gap="md">
            {sessions.map((session, sessionIndex) => (
              <section className="tc-share-conversation__session" key={session.sessionId}>
                {sessionIndex > 0 ? (
                  <Divider className="tc-share-conversation__session-divider" label="新会话" labelPosition="center" />
                ) : null}
                <Stack className="tc-share-conversation__messages" gap={10}>
                  {session.messages.map((message) => {
                    const isUser = message.role === 'user'
                    return (
                      <article
                        className={`tc-share-conversation__message${isUser ? ' tc-share-conversation__message--user' : ''}`}
                        key={message.id}
                      >
                        <Box className="tc-share-conversation__bubble">
                          <Group className="tc-share-conversation__message-heading" justify="space-between" gap={8} wrap="nowrap">
                            <Text className="tc-share-conversation__role" size="xs" c="dimmed">
                              {isUser ? '创作者' : '小T'}
                            </Text>
                            {message.content ? (
                              <Tooltip className="tc-share-conversation__tooltip" label="复制这条消息" withArrow>
                                <ActionIcon
                                  className="tc-share-conversation__copy"
                                  variant="subtle"
                                  size="xs"
                                  aria-label="复制这条消息"
                                  onClick={() => void copyMessage(message)}
                                >
                                  <IconCopy className="tc-share-conversation__copy-icon" size={13} />
                                </ActionIcon>
                              </Tooltip>
                            ) : null}
                          </Group>
                          {message.content ? (
                            <Text className="tc-share-conversation__content" size="sm">
                              {message.content}
                            </Text>
                          ) : null}
                          {message.assets.length > 0 ? (
                            <div className="tc-share-conversation__assets">
                              {message.assets.map((asset, assetIndex) => {
                                const assetKey = `${message.id}-${asset.taskId || asset.url || assetIndex}`
                                if (asset.type === 'video' && asset.url) {
                                  return (
                                    <video
                                      className="tc-share-conversation__video"
                                      key={assetKey}
                                      src={asset.url}
                                      poster={asset.thumbnailUrl || undefined}
                                      crossOrigin="anonymous"
                                      controls
                                      playsInline
                                      preload="metadata"
                                    />
                                  )
                                }
                                if (asset.type === 'audio' && asset.url) {
                                  return (
                                    <audio
                                      className="tc-share-conversation__audio"
                                      key={assetKey}
                                      src={asset.url}
                                      controls
                                      preload="metadata"
                                    />
                                  )
                                }
                                if (asset.type !== 'image') return null
                                const imageUrl = asset.thumbnailUrl || asset.url
                                return imageUrl ? (
                                  <ManagedImage
                                    className="tc-share-conversation__image"
                                    key={assetKey}
                                    src={imageUrl}
                                    alt={asset.title || '生成图片'}
                                    priority="visible"
                                  />
                                ) : null
                              })}
                            </div>
                          ) : null}
                        </Box>
                      </article>
                    )
                  })}
                </Stack>
              </section>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </aside>
  )
}
