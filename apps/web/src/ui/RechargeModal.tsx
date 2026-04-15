import React from 'react'
import { Badge, Button, Group, Modal, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import {
  createCommerceOrder,
  createWechatNativePayment,
  listRechargePackages,
  reconcileWechatPayment,
  type RechargePackageDto,
} from '../api/server'
import RechargeModelPricingDrawer from './RechargeModelPricingDrawer'
import { PanelCard } from './PanelCard'
import { toast } from './toast'

function centsToYuan(cents: number): string {
  return (Math.max(0, Number(cents || 0)) / 100).toFixed(2)
}

type PendingPay = {
  orderId: string
  orderNo: string
  codeUrl: string
}

export default function RechargeModal(props: {
  opened: boolean
  onClose: () => void
  onPaid?: () => void
}): JSX.Element {
  const { opened, onClose, onPaid } = props
  const [loading, setLoading] = React.useState(false)
  const [packages, setPackages] = React.useState<RechargePackageDto[]>([])
  const [payingProductId, setPayingProductId] = React.useState<string | null>(null)
  const [pendingPay, setPendingPay] = React.useState<PendingPay | null>(null)
  const [reconciling, setReconciling] = React.useState(false)
  const [pricingDrawerOpen, setPricingDrawerOpen] = React.useState(false)

  const loadPackages = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await listRechargePackages()
      setPackages(Array.isArray(data) ? data : [])
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '加载套餐失败'
      toast(msg, 'error')
      setPackages([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!opened) return
    void loadPackages()
  }, [opened, loadPackages])

  React.useEffect(() => {
    if (opened) return
    setPricingDrawerOpen(false)
  }, [opened])

  const handleBuy = React.useCallback(async (item: RechargePackageDto) => {
    setPayingProductId(item.productId)
    try {
      const order = await createCommerceOrder({
        items: [{ productId: item.productId, quantity: 1 }],
      })
      const pay = await createWechatNativePayment({ orderId: order.id })
      setPendingPay({
        orderId: order.id,
        orderNo: order.orderNo,
        codeUrl: pay.codeUrl,
      })
      toast('下单成功，请扫码支付', 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '创建支付失败'
      toast(msg, 'error')
    } finally {
      setPayingProductId(null)
    }
  }, [])

  const handleReconcile = React.useCallback(async () => {
    if (!pendingPay?.orderId) return
    setReconciling(true)
    try {
      const result = await reconcileWechatPayment(pendingPay.orderId)
      if (result.paymentStatus === 'success' && result.orderPaymentStatus === 'paid') {
        toast('支付成功，团队积分已到账', 'success')
        setPendingPay(null)
        onPaid?.()
      } else {
        toast(`当前状态：${result.tradeState || 'PENDING'}，请稍后重试`, 'error')
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '查单失败'
      toast(msg, 'error')
    } finally {
      setReconciling(false)
    }
  }, [onPaid, pendingPay?.orderId, pendingPay])

  return (
    <>
      <Modal className="recharge-modal" opened={opened} onClose={onClose} title="积分充值" centered size="lg">
      <Stack className="recharge-modal-stack" gap="md">
        <Group className="recharge-modal-header" justify="space-between" align="flex-start">
          <Text className="recharge-modal-subtitle" size="sm" c="dimmed">
            所有积分统一充值到当前团队账户；个人账号同样使用个人 team 账户。
          </Text>
          <Button
            className="recharge-modal-pricing-button"
            variant="light"
            size="xs"
            onClick={() => setPricingDrawerOpen(true)}
          >
            模型价格
          </Button>
        </Group>
        {loading ? (
          <Text className="recharge-modal-loading" size="sm" c="dimmed">加载中…</Text>
        ) : packages.length === 0 ? (
          <Text className="recharge-modal-empty" size="sm" c="dimmed">暂无可用充值套餐</Text>
        ) : (
          <SimpleGrid className="recharge-modal-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
            {packages.map((item) => (
              <PanelCard className="recharge-modal-card" key={item.productId}>
                <Stack className="recharge-modal-card-stack" gap={6}>
                  <Group className="recharge-modal-card-header" justify="space-between" align="center">
                    <Title className="recharge-modal-card-title" order={6}>{item.title}</Title>
                    <Badge className="recharge-modal-card-badge" color="green" variant="light">
                      赠送 {item.bonusPoints}
                    </Badge>
                  </Group>
                  {item.subtitle ? <Text className="recharge-modal-card-subtitle" size="xs" c="dimmed">{item.subtitle}</Text> : null}
                  <Text className="recharge-modal-card-price" size="sm" fw={700}>¥{centsToYuan(item.priceCents)}</Text>
                  <Text className="recharge-modal-card-points" size="xs" c="dimmed">
                    到账 {item.totalPoints} 积分（基础 {item.points} + 赠送 {item.bonusPoints}）
                  </Text>
                  <Button
                    className="recharge-modal-card-buy"
                    size="xs"
                    loading={payingProductId === item.productId}
                    onClick={() => void handleBuy(item)}
                  >
                    立即购买
                  </Button>
                </Stack>
              </PanelCard>
            ))}
          </SimpleGrid>
        )}

        {pendingPay ? (
          <PanelCard className="recharge-modal-pay">
            <Stack className="recharge-modal-pay-stack" gap="xs" align="center">
              <Text className="recharge-modal-pay-order" size="xs" c="dimmed">订单号：{pendingPay.orderNo}</Text>
              <img
                className="recharge-modal-pay-qrcode"
                alt="recharge-wechat-native-qrcode"
                width={220}
                height={220}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pendingPay.codeUrl)}`}
              />
              <Group className="recharge-modal-pay-actions" gap="xs">
                <Button className="recharge-modal-pay-check" size="xs" loading={reconciling} onClick={() => void handleReconcile()}>
                  我已支付，查询结果
                </Button>
              </Group>
            </Stack>
          </PanelCard>
        ) : null}
      </Stack>
      </Modal>
      <RechargeModelPricingDrawer
        opened={pricingDrawerOpen}
        onClose={() => setPricingDrawerOpen(false)}
      />
    </>
  )
}
