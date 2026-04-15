import React from 'react'
import { Badge, Button, Collapse, Divider, Drawer, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core'
import { preloadModelOptions } from '../config/useModelOptions'
import { PanelCard } from './PanelCard'
import { buildRechargeModelPricingSections, type RechargeModelPricingSection } from './rechargeModelPricing'

export type RechargeModelPricingDrawerProps = {
  opened: boolean
  onClose: () => void
}

export default function RechargeModelPricingDrawer({
  opened,
  onClose,
}: RechargeModelPricingDrawerProps): JSX.Element {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sections, setSections] = React.useState<RechargeModelPricingSection[]>([])
  const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({})

  const loadSections = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [textModels, imageModels, videoModels] = await Promise.all([
        preloadModelOptions('text'),
        preloadModelOptions('image'),
        preloadModelOptions('video'),
      ])
      setSections(buildRechargeModelPricingSections({
        textModels,
        imageModels,
        videoModels,
      }))
      setExpandedRows({})
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : '加载模型价格失败'
      setSections([])
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!opened) return
    void loadSections()
  }, [loadSections, opened])

  return (
    <Drawer
      className="recharge-model-pricing-drawer"
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      zIndex={400}
      title="当前启用模型价格"
    >
      <Stack className="recharge-model-pricing-drawer-stack" gap="md">
        <Text className="recharge-model-pricing-drawer-subtitle" size="sm" c="dimmed">
          仅展示当前系统模型管理里已启用的模型，价格单位统一为积分。
        </Text>

        {loading ? (
          <Group className="recharge-model-pricing-drawer-loading" gap="xs">
            <Loader className="recharge-model-pricing-drawer-loader" size="sm" />
            <Text className="recharge-model-pricing-drawer-loading-text" size="sm" c="dimmed">
              加载模型价格中…
            </Text>
          </Group>
        ) : error ? (
          <Text className="recharge-model-pricing-drawer-error" size="sm" c="red">
            {error}
          </Text>
        ) : sections.length === 0 ? (
          <Text className="recharge-model-pricing-drawer-empty" size="sm" c="dimmed">
            暂无已启用模型价格
          </Text>
        ) : (
          <ScrollArea className="recharge-model-pricing-drawer-scroll" offsetScrollbars>
            <Stack className="recharge-model-pricing-drawer-sections" gap="lg">
              {sections.map((section) => (
                <Stack className="recharge-model-pricing-drawer-section" gap="sm" key={section.kind}>
                  <Group className="recharge-model-pricing-drawer-section-header" justify="space-between" align="center">
                    <Text className="recharge-model-pricing-drawer-section-title" fw={700}>
                      {section.label}
                    </Text>
                    <Badge className="recharge-model-pricing-drawer-section-badge" variant="light">
                      {section.rows.length} 个模型
                    </Badge>
                  </Group>
                  <Divider className="recharge-model-pricing-drawer-section-divider" />
                  <Stack className="recharge-model-pricing-drawer-row-list" gap="xs">
                    {section.rows.map((row) => (
                      <PanelCard className="recharge-model-pricing-drawer-row" key={`${section.kind}-${row.value}`}>
                        {(() => {
                          const rowKey = `${section.kind}-${row.value}`
                          const isExpanded = Boolean(expandedRows[rowKey])
                          return (
                            <>
                        <Group className="recharge-model-pricing-drawer-row-main" justify="space-between" align="flex-start" wrap="nowrap">
                          <Stack className="recharge-model-pricing-drawer-row-meta" gap={2}>
                            <Text className="recharge-model-pricing-drawer-row-title" size="sm" fw={600}>
                              {row.label}
                            </Text>
                            <Text className="recharge-model-pricing-drawer-row-vendor" size="xs" c="dimmed">
                              {row.vendorLabel}
                            </Text>
                          </Stack>
                          <Stack className="recharge-model-pricing-drawer-row-price" gap={4} align="flex-end">
                            <Text className="recharge-model-pricing-drawer-row-base-price" size="sm" fw={600}>
                              {row.basePriceLabel}
                            </Text>
                            {row.specPriceLabels.length > 0 ? (
                              <Button
                                className="recharge-model-pricing-drawer-row-spec-toggle"
                                size="compact-xs"
                                variant="subtle"
                                aria-label={`${isExpanded ? '收起' : '展开'} ${row.label} 规格价格`}
                                onClick={() => {
                                  setExpandedRows((current) => ({
                                    ...current,
                                    [rowKey]: !current[rowKey],
                                  }))
                                }}
                              >
                                {isExpanded ? '收起规格价' : `${row.specPriceLabels.length} 个规格价`}
                              </Button>
                            ) : (
                              <Text
                                className="recharge-model-pricing-drawer-row-specs-empty"
                                size="xs"
                                c="dimmed"
                              >
                                无规格价
                              </Text>
                            )}
                          </Stack>
                        </Group>
                        {row.specPriceLabels.length > 0 ? (
                          <Collapse className="recharge-model-pricing-drawer-row-spec-collapse" in={isExpanded}>
                            <Group className="recharge-model-pricing-drawer-row-specs" gap={6} mt="xs">
                              {row.specPriceLabels.map((specLabel) => (
                                <Badge className="recharge-model-pricing-drawer-row-spec-badge" key={specLabel} variant="light" color="gray">
                                  {specLabel}
                                </Badge>
                              ))}
                            </Group>
                          </Collapse>
                        ) : null}
                            </>
                          )
                        })()}
                      </PanelCard>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Stack>
    </Drawer>
  )
}
