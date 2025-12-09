import React from 'react'
import { Button, Group, Paper, Text } from '@mantine/core'
import { IconUsers } from '@tabler/icons-react'

type CharacterContentProps = {
  characterPrimaryImage: string | null
  selectedCharacter: { displayName?: string | null; username?: string | null } | null
  placeholderColor: string
  onOpenAssets: () => void
  onRefresh: () => void
  tokenReady: boolean
}

export function CharacterContent({
  characterPrimaryImage,
  selectedCharacter,
  placeholderColor,
  onOpenAssets,
  onRefresh,
  tokenReady,
}: CharacterContentProps) {
  return (
    <div style={{ position: 'relative', marginTop: 6 }}>
      {characterPrimaryImage ? (
        <div
          style={{
            borderRadius: 10,
            overflow: 'hidden',
            border: 'none',
            position: 'relative',
            background: 'rgba(0,0,0,0.24)',
          }}
        >
          <img
            src={characterPrimaryImage}
            alt={selectedCharacter?.displayName || 'Sora 角色'}
            style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '12px 12px 10px',
              background: 'linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.0) 80%)',
              color: '#fff',
            }}
          >
            <Text size="sm" fw={600} style={{ marginBottom: 2 }}>
              {selectedCharacter?.displayName || 'Sora 角色'}
            </Text>
            {selectedCharacter?.username && (
              <Text size="xs" c="dimmed">
                @{selectedCharacter.username}
              </Text>
            )}
          </div>
          <Button
            size="xs"
            variant="light"
            style={{ position: 'absolute', top: 8, right: 8 }}
            onClick={onOpenAssets}
          >
            管理角色
          </Button>
        </div>
      ) : (
        <Paper
          radius="md"
          p="md"
          style={{
            minHeight: 140,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <IconUsers size={28} style={{ color: placeholderColor }} />
          <Text size="sm" c="dimmed">
            选择一个 Sora 角色，封面将显示在此处并可连接到视频节点。
          </Text>
          <Group gap={6}>
            <Button size="xs" variant="light" onClick={onOpenAssets}>
              打开资产面板
            </Button>
            <Button size="xs" variant="subtle" onClick={onRefresh} disabled={!tokenReady}>
              刷新角色
            </Button>
          </Group>
        </Paper>
      )}
    </div>
  )
}
