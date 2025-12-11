import React from 'react'
import { Box, Group, ScrollArea, Stack, Text, Title } from '@mantine/core'

type ShowcaseSectionProps = {
  title: string
  subtitle?: string
  rightSection?: React.ReactNode
  children: React.ReactNode
}

type HorizontalCarouselProps = {
  children: React.ReactNode
}

function HorizontalCarousel({ children }: HorizontalCarouselProps): JSX.Element {
  return (
    <ScrollArea
      type="hover"
      offsetScrollbars
      scrollbarSize={8}
      styles={{
        viewport: {
          paddingBottom: 4,
        },
      }}
    >
      <Group gap="md" wrap="nowrap">
        {children}
      </Group>
    </ScrollArea>
  )
}

export function ShowcaseSection({ title, subtitle, rightSection, children }: ShowcaseSectionProps): JSX.Element {
  return (
    <Stack gap={10} mb="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={4}>{title}</Title>
          {subtitle && (
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          )}
        </Stack>
        {rightSection && <Box>{rightSection}</Box>}
      </Group>
      <HorizontalCarousel>{children}</HorizontalCarousel>
    </Stack>
  )
}

