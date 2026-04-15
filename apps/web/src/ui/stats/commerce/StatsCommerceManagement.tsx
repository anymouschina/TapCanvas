import React from 'react'
import { Badge, Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title, UnstyledButton } from '@mantine/core'
import {
  cancelCommerceOrder,
  createCommerceOrder,
  createWechatNativePayment,
  deleteCommerceProduct,
  listCommerceOrders,
  listCommerceProducts,
  reconcileWechatPayment,
  updateCommerceProductStatus,
  upsertCommerceProduct,
  upsertProductEntitlement,
  type CommerceOrderDto,
  type CommerceProductDto,
  type ProductEntitlementType,
} from '../../../api/server'
import { InlinePanel } from '../../InlinePanel'
import { PanelCard } from '../../PanelCard'
import { toast } from '../../toast'
import StatsCommerceOpenClawPanel from './StatsCommerceOpenClawPanel'

function centsToYuan(cents: number): string {
  return (Math.max(0, Number(cents || 0)) / 100).toFixed(2)
}

function parseEntitlementConfig(configJson: string | null): Record<string, unknown> {
  if (!configJson) return {}
  try {
    const parsed: unknown = JSON.parse(configJson)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

type CommerceManagementSection = 'products' | 'orders' | 'openclaw'

type ProductFormMode = 'create' | 'edit'

type ProductSkuFormState = {
  id: string
  name: string
  spec: string
  priceYuan: number
  stock: number
  isDefault: boolean
  status: 'draft' | 'active' | 'inactive'
  points: number
  bonusPoints: number
  durationDays: number
  dailyLimit: number
  timezone: string
}

type OpenClawProductConfigState = {
  externalName: string
  descriptionText: string
  allowWallet: 'true' | 'false'
  allowedItemIdsText: string
}


type ProductFormState = {
  title: string
  subtitle: string
  description: string
  coverImageUrl: string
  currency: string
  status: 'draft' | 'active' | 'inactive'
  priceYuan: number
  stock: number
  entitlementType: ProductEntitlementType
  points: number
  bonusPoints: number
  durationDays: number
  dailyLimit: number
  timezone: string
  openclaw: OpenClawProductConfigState
  skus: ProductSkuFormState[]
}

function createDefaultSkuForm(isDefault = false): ProductSkuFormState {
  return {
    id: crypto.randomUUID(),
    name: '',
    spec: '',
    priceYuan: 99,
    stock: 100,
    isDefault,
    status: 'active',
    points: 0,
    bonusPoints: 0,
    durationDays: 30,
    dailyLimit: 1,
    timezone: 'Asia/Shanghai',
  }
}

const defaultProductForm: ProductFormState = {
  title: '',
  subtitle: '',
  description: '',
  coverImageUrl: '',
  currency: 'CNY',
  status: 'active',
  priceYuan: 99,
  stock: 100,
  entitlementType: 'none',
  points: 0,
  bonusPoints: 0,
  durationDays: 30,
  dailyLimit: 1,
  timezone: 'Asia/Shanghai',
  openclaw: {
    externalName: 'openclaw',
    descriptionText: '',
    allowWallet: 'true',
    allowedItemIdsText: '',
  },
  skus: [],
}

function createDefaultProductForm(): ProductFormState {
  return {
    ...defaultProductForm,
    openclaw: { ...defaultProductForm.openclaw },
    skus: [],
  }
}

export default function StatsCommerceManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-commerce-management', className].filter(Boolean).join(' ')
  const [section, setSection] = React.useState<CommerceManagementSection>('products')

  const [products, setProducts] = React.useState<CommerceProductDto[]>([])
  const [orders, setOrders] = React.useState<CommerceOrderDto[]>([])
  const [loadingProducts, setLoadingProducts] = React.useState(false)
  const [loadingOrders, setLoadingOrders] = React.useState(false)

  const [productModalOpen, setProductModalOpen] = React.useState(false)
  const [productModalMode, setProductModalMode] = React.useState<ProductFormMode>('create')
  const [editingProductId, setEditingProductId] = React.useState<string | null>(null)
  const [productForm, setProductForm] = React.useState<ProductFormState>(createDefaultProductForm)
  const [submittingProductForm, setSubmittingProductForm] = React.useState(false)

  const [createOrderProductId, setCreateOrderProductId] = React.useState<string | null>(null)
  const [createOrderSkuId, setCreateOrderSkuId] = React.useState<string | null>(null)
  const [createOrderQty, setCreateOrderQty] = React.useState<number | string>(1)
  const [creatingOrder, setCreatingOrder] = React.useState(false)

  const [payOrderId, setPayOrderId] = React.useState<string | null>(null)
  const [paying, setPaying] = React.useState(false)
  const [payCodeUrl, setPayCodeUrl] = React.useState<string | null>(null)

  const [reconcilingOrderId, setReconcilingOrderId] = React.useState<string | null>(null)
  const [updatingStatusProductId, setUpdatingStatusProductId] = React.useState<string | null>(null)
  const [deletingProductId, setDeletingProductId] = React.useState<string | null>(null)

  const reloadProducts = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingProducts(true)
    try {
      const data = await listCommerceProducts({ page: 1, size: 100 })
      const items = Array.isArray(data?.items) ? data.items : []
      setProducts(items)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '加载商品失败'
      toast(msg, 'error')
      setProducts([])
    } finally {
      if (!options?.silent) setLoadingProducts(false)
    }
  }, [])

  const reloadOrders = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingOrders(true)
    try {
      const data = await listCommerceOrders({ page: 1, size: 100 })
      setOrders(Array.isArray(data?.items) ? data.items : [])
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '加载订单失败'
      toast(msg, 'error')
      setOrders([])
    } finally {
      if (!options?.silent) setLoadingOrders(false)
    }
  }, [])

  const reloadAll = React.useCallback(async () => {
    await Promise.all([reloadProducts(), reloadOrders()])
  }, [reloadOrders, reloadProducts])

  const refreshCurrentSection = React.useCallback(async (targetSection: CommerceManagementSection, options?: { silent?: boolean }) => {
    if (targetSection === 'products') {
      await reloadProducts(options)
      return
    }
    if (targetSection === 'orders') {
      await reloadOrders(options)
      return
    }
  }, [reloadOrders, reloadProducts])

  React.useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  React.useEffect(() => {
    void refreshCurrentSection(section, { silent: true })
  }, [refreshCurrentSection, section])

  const commerceNavItems = [
    { value: 'products' as const, label: '商品管理', description: '商品、规格、权益与状态' },
    { value: 'orders' as const, label: '订单与支付', description: '创建订单、支付与补账' },
    { value: 'openclaw' as const, label: 'OpenClaw 维护', description: '用户授权、密钥维护与用量重置' },
  ]

  const commerceOverview = React.useMemo(() => ({
    productCount: products.length,
    activeProductCount: products.filter((item) => item.status === 'active').length,
    orderCount: orders.length,
    unpaidOrderCount: orders.filter((item) => item.paymentStatus === 'unpaid').length,
  }), [orders, products])

  const activeSectionMeta = commerceNavItems.find((item) => item.value === section) || commerceNavItems[0]

  const selectedCreateOrderProduct = React.useMemo(
    () => products.find((p) => p.id === createOrderProductId) || null,
    [createOrderProductId, products],
  )
  const selectedCreateOrderSkus = React.useMemo(
    () => (Array.isArray(selectedCreateOrderProduct?.skus) ? selectedCreateOrderProduct.skus : []),
    [selectedCreateOrderProduct],
  )

  React.useEffect(() => {
    if (!selectedCreateOrderSkus.length) {
      setCreateOrderSkuId(null)
      return
    }
    if (createOrderSkuId && selectedCreateOrderSkus.some((s) => s.id === createOrderSkuId)) return
    const defaultSku = selectedCreateOrderSkus.find((s) => s.isDefault) || selectedCreateOrderSkus[0]
    setCreateOrderSkuId(defaultSku?.id || null)
  }, [createOrderSkuId, selectedCreateOrderSkus])

  const openCreateProductModal = React.useCallback(() => {
    setProductModalMode('create')
    setEditingProductId(null)
    setProductForm(createDefaultProductForm())
    setProductModalOpen(true)
  }, [])

  const activeSectionActions = React.useMemo(() => {
    if (section === 'products') {
      return (
        <Group className="stats-commerce-section-actions" gap="xs" wrap="wrap">
          <Button className="stats-commerce-section-refresh" variant="light" onClick={() => void refreshCurrentSection('products')}>刷新商品</Button>
          <Button className="stats-commerce-section-create-product" variant="light" onClick={openCreateProductModal}>新建商品</Button>
        </Group>
      )
    }
    if (section === 'orders') {
      return (
        <Group className="stats-commerce-section-actions" gap="xs" wrap="wrap">
          <Button className="stats-commerce-section-refresh" variant="light" onClick={() => void refreshCurrentSection('orders')}>刷新订单</Button>
        </Group>
      )
    }
    return null
  }, [openCreateProductModal, refreshCurrentSection, section])

  const openEditProductModal = React.useCallback((product: CommerceProductDto) => {
    const entitlementType = product.entitlementType || 'none'
    const cfg = parseEntitlementConfig(product.entitlementConfigJson || null)
    const points = Math.max(0, Math.trunc(Number(cfg.points || 0)))
    const bonusPoints = Math.max(0, Math.trunc(Number(cfg.bonusPoints || 0)))
    const durationDays = Math.max(1, Math.trunc(Number(cfg.durationDays || 30)))
    const dailyLimit = Math.max(1, Math.trunc(Number(cfg.dailyLimit || 1)))
    const timezone = typeof cfg.timezone === 'string' && cfg.timezone.trim() ? cfg.timezone.trim() : 'Asia/Shanghai'
    const externalName = typeof cfg.externalName === 'string' && cfg.externalName.trim() ? cfg.externalName.trim() : 'openclaw'
    const descriptionText = typeof cfg.descriptionText === 'string' ? cfg.descriptionText : ''
    const allowWallet = cfg.allowWallet === false ? 'false' : 'true'
    const allowedItemIds = Array.isArray(cfg.allowedItemIds) ? cfg.allowedItemIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
    const skuConfigs = (cfg.skuConfigs && typeof cfg.skuConfigs === 'object') ? cfg.skuConfigs as Record<string, unknown> : {}
    const skus = (Array.isArray(product.skus) ? product.skus : []).map((sku, index) => {
      const skuCfgRaw = skuConfigs[sku.id]
      const skuCfg = skuCfgRaw && typeof skuCfgRaw === 'object' ? skuCfgRaw as Record<string, unknown> : {}
      return {
        id: sku.id,
        name: String(sku.name || ''),
        spec: String(sku.spec || ''),
        priceYuan: Math.max(0, Number(sku.priceCents || 0) / 100),
        stock: Math.max(0, Math.trunc(Number(sku.stock || 0))),
        isDefault: Boolean(sku.isDefault || index === 0),
        status: (sku.status === 'active' || sku.status === 'inactive' || sku.status === 'draft') ? sku.status : 'active',
        points: Math.max(0, Math.trunc(Number(skuCfg.points || 0))),
        bonusPoints: Math.max(0, Math.trunc(Number(skuCfg.bonusPoints || 0))),
        durationDays: Math.max(1, Math.trunc(Number(skuCfg.durationDays || durationDays))),
        dailyLimit: Math.max(1, Math.trunc(Number(skuCfg.dailyLimit || dailyLimit))),
        timezone: typeof skuCfg.timezone === 'string' && skuCfg.timezone.trim() ? skuCfg.timezone.trim() : timezone,
      } as ProductSkuFormState
    })

    setProductModalMode('edit')
    setEditingProductId(product.id)
    setProductForm({
      title: String(product.title || ''),
      subtitle: String(product.subtitle || ''),
      description: String(product.description || ''),
      coverImageUrl: String(product.coverImageUrl || ''),
      currency: String(product.currency || 'CNY').toUpperCase(),
      status: (product.status === 'active' || product.status === 'inactive' || product.status === 'draft') ? product.status : 'active',
      priceYuan: Math.max(0, Number(product.priceCents || 0) / 100),
      stock: Math.max(0, Math.trunc(Number(product.stock || 0))),
      entitlementType,
      points,
      bonusPoints,
      durationDays,
      dailyLimit,
      timezone,
      openclaw: {
        externalName,
        descriptionText,
        allowWallet,
        allowedItemIdsText: allowedItemIds.join('\n'),
      },
      skus,
    })
    setProductModalOpen(true)
  }, [])

  const submitProductForm = React.useCallback(async () => {
    const title = String(productForm.title || '').trim()
    const subtitle = String(productForm.subtitle || '').trim()
    const description = String(productForm.description || '').trim()
    const coverImageUrl = String(productForm.coverImageUrl || '').trim()
    const currency = String(productForm.currency || 'CNY').trim().toUpperCase() || 'CNY'
    const status = productForm.status
    const entitlementType = productForm.entitlementType
    const points = Math.max(0, Math.trunc(Number(productForm.points || 0)))
    const bonusPoints = Math.max(0, Math.trunc(Number(productForm.bonusPoints || 0)))
    const durationDays = Math.max(1, Math.trunc(Number(productForm.durationDays || 30)))
    const dailyLimit = Math.max(1, Math.trunc(Number(productForm.dailyLimit || 1)))
    const timezone = String(productForm.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
    const openclawExternalName = String(productForm.openclaw.externalName || 'openclaw').trim() || 'openclaw'
    const openclawDescriptionText = String(productForm.openclaw.descriptionText || '').trim()
    const openclawAllowWallet = productForm.openclaw.allowWallet !== 'false'
    const openclawAllowedItemIds = String(productForm.openclaw.allowedItemIdsText || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    const priceYuan = Number(productForm.priceYuan || 0)
    const stock = Number(productForm.stock || 0)
    const skus = (Array.isArray(productForm.skus) ? productForm.skus : [])
      .map((sku, index) => ({
        id: String(sku.id || '').trim() || crypto.randomUUID(),
        name: String(sku.name || '').trim(),
        spec: String(sku.spec || '').trim(),
        priceCents: Math.round(Math.max(0, Number(sku.priceYuan || 0)) * 100),
        stock: Math.max(0, Math.trunc(Number(sku.stock || 0))),
        isDefault: Boolean(sku.isDefault || index === 0),
        status: (sku.status === 'active' || sku.status === 'inactive' || sku.status === 'draft') ? sku.status : 'active',
        points: Math.max(0, Math.trunc(Number(sku.points || 0))),
        bonusPoints: Math.max(0, Math.trunc(Number(sku.bonusPoints || 0))),
        durationDays: Math.max(1, Math.trunc(Number(sku.durationDays || durationDays))),
        dailyLimit: Math.max(1, Math.trunc(Number(sku.dailyLimit || dailyLimit))),
        timezone: String(sku.timezone || timezone).trim() || timezone,
      }))
      .filter((sku) => sku.name)

    if (!title) {
      toast('请输入商品标题', 'error')
      return
    }
    if (!Number.isFinite(priceYuan) || priceYuan < 0) {
      toast('请输入有效价格', 'error')
      return
    }
    if (!Number.isFinite(stock) || stock < 0) {
      toast('请输入有效库存', 'error')
      return
    }
    if (skus.some((sku) => !Number.isFinite(sku.priceCents) || sku.priceCents < 0 || !Number.isFinite(sku.stock) || sku.stock < 0)) {
      toast('SKU 价格/库存无效', 'error')
      return
    }
    if (coverImageUrl) {
      try {
        const u = new URL(coverImageUrl)
        if (!/^https?:$/.test(u.protocol)) throw new Error('invalid')
      } catch {
        toast('封面图链接必须是有效的 http/https URL', 'error')
        return
      }
    }
    if (entitlementType === 'points_topup' && points <= 0) {
      toast('积分充值商品必须填写基础积分（>0）', 'error')
      return
    }
    if (entitlementType === 'openclaw_subscription' && !openclawExternalName) {
      toast('OpenClaw 套餐必须填写外部密钥名称', 'error')
      return
    }

    setSubmittingProductForm(true)
    try {
      const product = await upsertCommerceProduct({
        ...(productModalMode === 'edit' && editingProductId ? { id: editingProductId } : {}),
        title,
        subtitle: subtitle || undefined,
        description: description || undefined,
        priceCents: Math.round(priceYuan * 100),
        stock: Math.trunc(stock),
        status,
        currency,
        coverImageUrl: coverImageUrl || undefined,
        skus: skus.map((sku) => ({
          id: sku.id,
          name: sku.name,
          spec: sku.spec,
          priceCents: sku.priceCents,
          stock: sku.stock,
          isDefault: sku.isDefault,
          status: sku.status,
        })),
      })

      const skuConfigs = Object.fromEntries(
        skus.map((sku) => [
          sku.id,
          entitlementType === 'points_topup'
            ? {
              points: sku.points,
              bonusPoints: sku.bonusPoints,
            }
            : entitlementType === 'monthly_quota' || entitlementType === 'openclaw_subscription'
              ? {
                durationDays: sku.durationDays,
                dailyLimit: sku.dailyLimit,
                timezone: sku.timezone,
              }
              : {},
        ]),
      )

      await upsertProductEntitlement(product.id, {
        entitlementType,
        config: entitlementType === 'points_topup'
          ? { points, bonusPoints, skuConfigs }
          : entitlementType === 'monthly_quota'
            ? { durationDays, dailyLimit, timezone, skuConfigs }
            : entitlementType === 'openclaw_subscription'
              ? {
                durationDays,
                dailyLimit,
                timezone,
                externalName: openclawExternalName,
                descriptionText: openclawDescriptionText || undefined,
                allowWallet: openclawAllowWallet,
                allowedItemIds: openclawAllowedItemIds.length ? openclawAllowedItemIds : null,
                skuConfigs,
              }
              : {},
      })

      toast(productModalMode === 'edit' ? '商品已更新' : '商品已创建', 'success')
      setProductModalOpen(false)
      setEditingProductId(null)
      setProductForm(createDefaultProductForm())
      await reloadProducts({ silent: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : (productModalMode === 'edit' ? '更新商品失败' : '创建商品失败')
      toast(msg, 'error')
    } finally {
      setSubmittingProductForm(false)
    }
  }, [editingProductId, productForm, productModalMode, reloadProducts])

  const handleUpdateProductStatus = React.useCallback(async (productId: string, status: 'active' | 'inactive') => {
    setUpdatingStatusProductId(productId)
    try {
      await updateCommerceProductStatus(productId, status)
      toast('状态已更新', 'success')
      await reloadProducts({ silent: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '更新失败'
      toast(msg, 'error')
    } finally {
      setUpdatingStatusProductId(null)
    }
  }, [reloadProducts])

  const handleDeleteProduct = React.useCallback(async (productId: string) => {
    setDeletingProductId(productId)
    try {
      await deleteCommerceProduct(productId)
      toast('商品已删除', 'success')
      await reloadProducts({ silent: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '删除失败'
      toast(msg, 'error')
    } finally {
      setDeletingProductId(null)
    }
  }, [reloadProducts])

  const handleCreateOrder = React.useCallback(async () => {
    const productId = String(createOrderProductId || '').trim()
    const skuId = String(createOrderSkuId || '').trim()
    const quantity = Number(createOrderQty || 0)
    if (!productId) {
      toast('请选择商品', 'error')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast('请输入有效购买数量', 'error')
      return
    }
    setCreatingOrder(true)
    try {
      await createCommerceOrder({ items: [{ productId, ...(skuId ? { skuId } : {}), quantity: Math.trunc(quantity) }] })
      toast('订单已创建', 'success')
      await reloadOrders({ silent: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '创建订单失败'
      toast(msg, 'error')
    } finally {
      setCreatingOrder(false)
    }
  }, [createOrderProductId, createOrderQty, createOrderSkuId, reloadOrders])

  const handlePayOrder = React.useCallback(async () => {
    const orderId = String(payOrderId || '').trim()
    if (!orderId) {
      toast('请选择订单', 'error')
      return
    }
    setPaying(true)
    try {
      const result = await createWechatNativePayment({ orderId })
      setPayCodeUrl(result.codeUrl)
      toast('已生成微信扫码支付二维码', 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '发起支付失败'
      toast(msg, 'error')
    } finally {
      setPaying(false)
    }
  }, [payOrderId])

  const handleReconcileOrder = React.useCallback(async (orderId: string) => {
    setReconcilingOrderId(orderId)
    try {
      const result = await reconcileWechatPayment(orderId)
      if (result.paymentStatus === 'success' && result.orderPaymentStatus === 'paid') {
        toast('已补账成功，订单状态已更新', 'success')
      } else {
        toast(`当前状态：${result.tradeState || 'PENDING'}`, 'error')
      }
      await reloadOrders({ silent: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '查单失败'
      toast(msg, 'error')
    } finally {
      setReconcilingOrderId(null)
    }
  }, [reloadOrders])

  return (
    <Stack className={rootClassName} gap="md">
      <PanelCard className="stats-commerce-header">
        <Stack className="stats-commerce-header-stack" gap="md">
          <Group className="stats-commerce-header-row" justify="space-between" align="center" wrap="wrap">
            <div className="stats-commerce-title-wrap">
              <Title className="stats-commerce-title" order={4}>商城管理</Title>
              <Text className="stats-commerce-subtitle" size="xs" c="dimmed">
                改成后台式分区：左边导航，右边只处理当前任务，减少一页堆满商品 / 订单 / 支付 / 样例库。
              </Text>
            </div>
          </Group>

          <SimpleGrid className="stats-commerce-overview-grid" cols={{ base: 2, md: 4 }} spacing="sm">
            <InlinePanel className="stats-commerce-overview-card">
              <Text className="stats-commerce-overview-label" size="xs" c="dimmed">商品总数</Text>
              <Text className="stats-commerce-overview-value" size="xl" fw={700}>{commerceOverview.productCount}</Text>
            </InlinePanel>
            <InlinePanel className="stats-commerce-overview-card">
              <Text className="stats-commerce-overview-label" size="xs" c="dimmed">启用商品</Text>
              <Text className="stats-commerce-overview-value" size="xl" fw={700}>{commerceOverview.activeProductCount}</Text>
            </InlinePanel>
            <InlinePanel className="stats-commerce-overview-card">
              <Text className="stats-commerce-overview-label" size="xs" c="dimmed">订单总数</Text>
              <Text className="stats-commerce-overview-value" size="xl" fw={700}>{commerceOverview.orderCount}</Text>
            </InlinePanel>
            <InlinePanel className="stats-commerce-overview-card">
              <Text className="stats-commerce-overview-label" size="xs" c="dimmed">待支付订单</Text>
              <Text className="stats-commerce-overview-value" size="xl" fw={700}>{commerceOverview.unpaidOrderCount}</Text>
            </InlinePanel>
          </SimpleGrid>
        </Stack>
      </PanelCard>

      <Group className="stats-commerce-layout" align="stretch" gap="md" wrap="nowrap">
        <PanelCard className="stats-commerce-sidebar" padding="compact" miw={220} maw={260}>
          <Stack className="stats-commerce-sidebar-stack" gap="xs">
            <Text className="stats-commerce-sidebar-title" fw={700} size="sm">商城工作台</Text>
            <Text className="stats-commerce-sidebar-subtitle" size="xs" c="dimmed">先选业务区，再处理当前区内的操作。</Text>
            {commerceNavItems.map((item) => {
              const active = item.value === section
              return (
                <UnstyledButton
                  className="stats-commerce-sidebar-item"
                  key={item.value}
                  onClick={() => setSection(item.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    borderRadius: 12,
                    padding: '12px 14px',
                    background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                    border: active ? '1px solid rgba(59,130,246,0.22)' : '1px solid transparent',
                  }}
                >
                  <Stack className="stats-commerce-sidebar-item-stack" gap={4}>
                    <Group className="stats-commerce-sidebar-item-row" justify="space-between" align="center" wrap="nowrap">
                      <Text className="stats-commerce-sidebar-item-label" size="sm" fw={600}>{item.label}</Text>
                      {active ? <Badge className="stats-commerce-sidebar-item-badge" size="xs" variant="light" color="blue">当前</Badge> : null}
                    </Group>
                    <Text className="stats-commerce-sidebar-item-description" size="xs" c="dimmed">{item.description}</Text>
                  </Stack>
                </UnstyledButton>
              )
            })}
          </Stack>
        </PanelCard>

        <Stack className="stats-commerce-content" gap="md" style={{ flex: 1, minWidth: 0 }}>
          <PanelCard className="stats-commerce-section-header">
            <Group className="stats-commerce-section-header-row" justify="space-between" align="center" wrap="wrap">
              <div className="stats-commerce-section-title-wrap">
                <Title className="stats-commerce-section-title" order={5}>{activeSectionMeta.label}</Title>
                <Text className="stats-commerce-section-subtitle" size="sm" c="dimmed">{activeSectionMeta.description}</Text>
              </div>
              <Group className="stats-commerce-section-header-side" gap="xs" wrap="wrap">
                <Badge className="stats-commerce-section-badge" variant="light" color="blue">{activeSectionMeta.label}</Badge>
                {activeSectionActions}
              </Group>
            </Group>
          </PanelCard>

          {section === 'products' ? (
            <PanelCard className="stats-commerce-product-list">
              <Stack className="stats-commerce-product-list-stack" gap="sm">
                <Group className="stats-commerce-product-list-header" justify="space-between" align="center" wrap="wrap">
                  <Title className="stats-commerce-product-list-title" order={5}>商品列表</Title>
                  <Text className="stats-commerce-product-list-subtitle" size="xs" c="dimmed">统一管理商品、SKU、库存和权益配置。</Text>
                </Group>
                <div className="stats-commerce-product-table-wrap" style={{ overflowX: 'auto' }}>
                  <Table className="stats-commerce-product-table" striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead className="stats-commerce-product-table-head">
                      <Table.Tr className="stats-commerce-product-table-head-row">
                        <Table.Th className="stats-commerce-product-table-head-cell">商品</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">价格</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">库存</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">状态</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">权益</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">更新时间</Table.Th>
                        <Table.Th className="stats-commerce-product-table-head-cell">操作</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody className="stats-commerce-product-table-body">
                      {loadingProducts ? (
                        <Table.Tr className="stats-commerce-product-table-loading-row">
                          <Table.Td className="stats-commerce-product-table-loading-cell" colSpan={7}>加载中...</Table.Td>
                        </Table.Tr>
                      ) : products.length === 0 ? (
                        <Table.Tr className="stats-commerce-product-table-empty-row">
                          <Table.Td className="stats-commerce-product-table-empty-cell" colSpan={7}>暂无商品</Table.Td>
                        </Table.Tr>
                      ) : products.map((product) => {
                        const cfg = parseEntitlementConfig(product.entitlementConfigJson || null)
                        const points = Math.max(0, Math.trunc(Number(cfg.points || 0)))
                        const bonusPoints = Math.max(0, Math.trunc(Number(cfg.bonusPoints || 0)))
                        const durationDays = Math.max(1, Math.trunc(Number(cfg.durationDays || 30)))
                        const dailyLimit = Math.max(1, Math.trunc(Number(cfg.dailyLimit || 1)))
                        const skus = Array.isArray(product.skus) ? product.skus : []
                        const skuPriceMin = skus.length ? Math.min(...skus.map((s) => Number(s.priceCents || 0))) : Number(product.priceCents || 0)
                        const skuPriceMax = skus.length ? Math.max(...skus.map((s) => Number(s.priceCents || 0))) : Number(product.priceCents || 0)
                        const totalStock = skus.length ? skus.reduce((sum, s) => sum + Math.max(0, Math.trunc(Number(s.stock || 0))), 0) : Math.max(0, Math.trunc(Number(product.stock || 0)))
                        return (
                          <Table.Tr className="stats-commerce-product-table-row" key={product.id}>
                            <Table.Td className="stats-commerce-product-table-cell">
                              <Stack className="stats-commerce-product-main" gap={0}>
                                <Text className="stats-commerce-product-title" size="sm" fw={600}>{product.title}</Text>
                                <Text className="stats-commerce-product-subtitle" size="xs" c="dimmed">
                                  {product.subtitle || '—'}{skus.length ? ` · ${skus.length} 个规格` : ''}
                                </Text>
                              </Stack>
                            </Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">
                              {skus.length
                                ? `¥${centsToYuan(skuPriceMin)} - ¥${centsToYuan(skuPriceMax)}`
                                : `¥${centsToYuan(product.priceCents)}`}
                            </Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">{totalStock}</Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">
                              <Badge className="stats-commerce-product-table-status" color={product.status === 'active' ? 'green' : product.status === 'draft' ? 'yellow' : 'gray'}>{product.status}</Badge>
                            </Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">
                              {product.entitlementType === 'points_topup' ? (
                                <Text className="stats-commerce-product-entitlement" size="xs" c="dimmed">points_topup（{points}+{bonusPoints}）</Text>
                              ) : product.entitlementType === 'monthly_quota' ? (
                                <Text className="stats-commerce-product-entitlement" size="xs" c="dimmed">monthly_quota（{dailyLimit}/天 · {durationDays}天）</Text>
                              ) : product.entitlementType === 'openclaw_subscription' ? (
                                <Text className="stats-commerce-product-entitlement" size="xs" c="dimmed">openclaw（{String(cfg.externalName || 'openclaw')} · {dailyLimit}/天 · {durationDays}天）</Text>
                              ) : (
                                <Text className="stats-commerce-product-entitlement" size="xs" c="dimmed">none</Text>
                              )}
                            </Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">
                              <Text className="stats-commerce-product-updated-at" size="xs" c="dimmed">{new Date(product.updatedAt).toLocaleString()}</Text>
                            </Table.Td>
                            <Table.Td className="stats-commerce-product-table-cell">
                              <Group className="stats-commerce-product-actions" gap={6} wrap="wrap">
                                <Button className="stats-commerce-product-action-edit" size="xs" variant="light" onClick={() => openEditProductModal(product)}>编辑</Button>
                                <Button
                                  className="stats-commerce-product-action-toggle"
                                  size="xs"
                                  variant="light"
                                  loading={updatingStatusProductId === product.id}
                                  onClick={() => void handleUpdateProductStatus(product.id, product.status === 'active' ? 'inactive' : 'active')}
                                >
                                  {product.status === 'active' ? '下架' : '上架'}
                                </Button>
                                <Button
                                  className="stats-commerce-product-action-delete"
                                  size="xs"
                                  color="red"
                                  variant="subtle"
                                  loading={deletingProductId === product.id}
                                  onClick={() => void handleDeleteProduct(product.id)}
                                >
                                  删除
                                </Button>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        )
                      })}
                    </Table.Tbody>
                  </Table>
                </div>
              </Stack>
            </PanelCard>
          ) : null}

          {section === 'openclaw' ? (
            <StatsCommerceOpenClawPanel className="stats-commerce-openclaw-panel" />
          ) : null}

          {section === 'orders' ? (
            <>
              <SimpleGrid className="stats-commerce-orders-grid" cols={{ base: 1, xl: 2 }} spacing="md">
                <PanelCard className="stats-commerce-order-create">
                  <Stack className="stats-commerce-order-create-stack" gap="sm">
                    <Title className="stats-commerce-order-create-title" order={5}>创建订单</Title>
                    <Group className="stats-commerce-order-create-form" align="end" grow>
                      <Select
                        className="stats-commerce-order-create-product-select"
                        label="商品"
                        placeholder="选择商品"
                        value={createOrderProductId}
                        onChange={setCreateOrderProductId}
                        data={products.map((product) => ({ value: product.id, label: product.title }))}
                      />
                      <Select
                        className="stats-commerce-order-create-sku-select"
                        label="规格"
                        placeholder={selectedCreateOrderSkus.length ? '选择规格' : '该商品无规格'}
                        value={createOrderSkuId}
                        onChange={setCreateOrderSkuId}
                        disabled={!selectedCreateOrderSkus.length}
                        data={selectedCreateOrderSkus.map((sku) => ({
                          value: sku.id,
                          label: `${sku.name}${sku.spec ? ` / ${sku.spec}` : ''} (¥${centsToYuan(sku.priceCents)})`,
                        }))}
                      />
                      <NumberInput className="stats-commerce-order-create-qty-input" label="数量" min={1} value={createOrderQty} onChange={setCreateOrderQty} />
                      <Button className="stats-commerce-order-create-submit" loading={creatingOrder} onClick={() => void handleCreateOrder()}>创建订单</Button>
                    </Group>
                  </Stack>
                </PanelCard>

                <PanelCard className="stats-commerce-payment-create">
                  <Stack className="stats-commerce-payment-create-stack" gap="sm">
                    <Title className="stats-commerce-payment-create-title" order={5}>发起微信 Native 支付</Title>
                    <Group className="stats-commerce-payment-create-form" align="end" grow>
                      <Select
                        className="stats-commerce-payment-order-select"
                        label="待支付订单"
                        placeholder="选择订单"
                        value={payOrderId}
                        onChange={setPayOrderId}
                        data={orders.filter((o) => o.paymentStatus === 'unpaid').map((o) => ({ value: o.id, label: `${o.orderNo} (¥${centsToYuan(o.totalAmountCents)})` }))}
                      />
                      <Button className="stats-commerce-payment-submit" loading={paying} onClick={() => void handlePayOrder()}>去支付</Button>
                    </Group>
                    {payCodeUrl ? (
                      <Stack className="stats-commerce-payment-qrcode-wrap" gap={6} align="center">
                        <img
                          className="stats-commerce-payment-qrcode-image"
                          alt="wechat-native-pay-qrcode"
                          width={220}
                          height={220}
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payCodeUrl)}`}
                        />
                        <Text className="stats-commerce-payment-qrcode-tip" size="xs" c="dimmed">请使用微信扫码完成支付</Text>
                      </Stack>
                    ) : (
                      <Text className="stats-commerce-payment-qrcode-empty" size="xs" c="dimmed">选择未支付订单后再发起支付，二维码会展示在这里。</Text>
                    )}
                  </Stack>
                </PanelCard>
              </SimpleGrid>

              <PanelCard className="stats-commerce-order-list">
                <Stack className="stats-commerce-order-list-stack" gap="sm">
                  <Group className="stats-commerce-order-list-header" justify="space-between" align="center" wrap="wrap">
                    <Title className="stats-commerce-order-list-title" order={5}>订单列表</Title>
                    <Text className="stats-commerce-order-list-subtitle" size="xs" c="dimmed">统一查看订单、支付状态和人工补账操作。</Text>
                  </Group>
                  <div className="stats-commerce-order-table-wrap" style={{ overflowX: 'auto' }}>
                    <Table className="stats-commerce-order-table" striped highlightOnHover withTableBorder withColumnBorders>
                      <Table.Thead className="stats-commerce-order-table-head">
                        <Table.Tr className="stats-commerce-order-table-head-row">
                          <Table.Th className="stats-commerce-order-table-head-cell">订单号</Table.Th>
                          <Table.Th className="stats-commerce-order-table-head-cell">金额</Table.Th>
                          <Table.Th className="stats-commerce-order-table-head-cell">订单状态</Table.Th>
                          <Table.Th className="stats-commerce-order-table-head-cell">支付状态</Table.Th>
                          <Table.Th className="stats-commerce-order-table-head-cell">创建时间</Table.Th>
                          <Table.Th className="stats-commerce-order-table-head-cell">操作</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody className="stats-commerce-order-table-body">
                        {loadingOrders ? (
                          <Table.Tr className="stats-commerce-order-table-loading-row">
                            <Table.Td className="stats-commerce-order-table-loading-cell" colSpan={6}>加载中...</Table.Td>
                          </Table.Tr>
                        ) : orders.length === 0 ? (
                          <Table.Tr className="stats-commerce-order-table-empty-row">
                            <Table.Td className="stats-commerce-order-table-empty-cell" colSpan={6}>暂无订单</Table.Td>
                          </Table.Tr>
                        ) : orders.map((order) => (
                          <Table.Tr className="stats-commerce-order-table-row" key={order.id}>
                            <Table.Td className="stats-commerce-order-table-cell">{order.orderNo}</Table.Td>
                            <Table.Td className="stats-commerce-order-table-cell">¥{centsToYuan(order.totalAmountCents)}</Table.Td>
                            <Table.Td className="stats-commerce-order-table-cell">{order.status}</Table.Td>
                            <Table.Td className="stats-commerce-order-table-cell">{order.paymentStatus}</Table.Td>
                            <Table.Td className="stats-commerce-order-table-cell">{new Date(order.createdAt).toLocaleString()}</Table.Td>
                            <Table.Td className="stats-commerce-order-table-cell">
                              {order.paymentStatus === 'unpaid' ? (
                                <Group className="stats-commerce-order-table-actions" gap={6} wrap="wrap">
                                  <Button className="stats-commerce-order-table-reconcile" size="xs" variant="light" loading={reconcilingOrderId === order.id} onClick={() => void handleReconcileOrder(order.id)}>查单补账</Button>
                                  <Button className="stats-commerce-order-table-cancel" size="xs" color="red" variant="subtle" onClick={() => void cancelCommerceOrder(order.id, 'admin_cancel').then(() => reloadOrders()).catch((e: unknown) => toast(e instanceof Error ? e.message : '取消失败', 'error'))}>取消</Button>
                                </Group>
                              ) : (
                                <Text className="stats-commerce-order-table-static" size="xs" c="dimmed">—</Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </div>
                </Stack>
              </PanelCard>
            </>
          ) : null}
        </Stack>
      </Group>

      <Modal
        className="stats-commerce-product-modal"
        opened={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={productModalMode === 'edit' ? '编辑商品' : '新建商品'}
        centered
        size="lg"
        lockScroll={false}
      >
        <Stack className="stats-commerce-product-modal-stack" gap="sm">
          <Group className="stats-commerce-product-modal-line" align="end" grow>
            <TextInput className="stats-commerce-product-modal-title-input" label="商品标题" placeholder="输入标题" value={productForm.title} onChange={(e) => setProductForm((s) => ({ ...s, title: e.currentTarget.value }))} />
            <TextInput className="stats-commerce-product-modal-subtitle-input" label="副标题" placeholder="可选" value={productForm.subtitle} onChange={(e) => setProductForm((s) => ({ ...s, subtitle: e.currentTarget.value }))} />
          </Group>
          <Group className="stats-commerce-product-modal-line" align="end" grow>
            <TextInput className="stats-commerce-product-modal-cover-input" label="封面图 URL" placeholder="https://..." value={productForm.coverImageUrl} onChange={(e) => setProductForm((s) => ({ ...s, coverImageUrl: e.currentTarget.value }))} />
            <Select className="stats-commerce-product-modal-currency-select" label="币种" value={productForm.currency} onChange={(v) => setProductForm((s) => ({ ...s, currency: String(v || 'CNY') }))} data={[{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]} />
            <Select className="stats-commerce-product-modal-status-select" label="状态" value={productForm.status} onChange={(v) => setProductForm((s) => ({ ...s, status: (v === 'active' || v === 'inactive' || v === 'draft') ? v : 'active' }))} data={[{ value: 'active', label: 'active' }, { value: 'draft', label: 'draft' }, { value: 'inactive', label: 'inactive' }]} />
          </Group>
          <Group className="stats-commerce-product-modal-line" align="end" grow>
            <NumberInput className="stats-commerce-product-modal-price-input" label="价格(元)" min={0} decimalScale={2} fixedDecimalScale value={productForm.priceYuan} onChange={(v) => setProductForm((s) => ({ ...s, priceYuan: Number(v || 0) }))} />
            <NumberInput className="stats-commerce-product-modal-stock-input" label="库存" min={0} value={productForm.stock} onChange={(v) => setProductForm((s) => ({ ...s, stock: Number(v || 0) }))} />
            <Select className="stats-commerce-product-modal-entitlement-select" label="权益类型" value={productForm.entitlementType} onChange={(v) => setProductForm((s) => ({ ...s, entitlementType: (v === 'points_topup' || v === 'monthly_quota' || v === 'openclaw_subscription' || v === 'none') ? v : 'none' }))} data={[{ value: 'none', label: 'none' }, { value: 'points_topup', label: 'points_topup（积分充值）' }, { value: 'monthly_quota', label: 'monthly_quota（月额度）' }, { value: 'openclaw_subscription', label: 'openclaw_subscription（OpenClaw 订阅）' }]} />
          </Group>
          {productForm.entitlementType === 'points_topup' ? (
            <Group className="stats-commerce-product-modal-line" align="end" grow>
              <NumberInput className="stats-commerce-product-modal-points-input" label="基础积分" min={0} value={productForm.points} onChange={(v) => setProductForm((s) => ({ ...s, points: Math.max(0, Math.trunc(Number(v || 0))) }))} />
              <NumberInput className="stats-commerce-product-modal-bonus-input" label="赠送积分" min={0} value={productForm.bonusPoints} onChange={(v) => setProductForm((s) => ({ ...s, bonusPoints: Math.max(0, Math.trunc(Number(v || 0))) }))} />
            </Group>
          ) : null}
          {productForm.entitlementType === 'monthly_quota' || productForm.entitlementType === 'openclaw_subscription' ? (
            <Group className="stats-commerce-product-modal-line" align="end" grow>
              <NumberInput className="stats-commerce-product-modal-duration-input" label="时长(天)" min={1} value={productForm.durationDays} onChange={(v) => setProductForm((s) => ({ ...s, durationDays: Math.max(1, Math.trunc(Number(v || 30))) }))} />
              <NumberInput className="stats-commerce-product-modal-daily-limit-input" label="日额度" min={1} value={productForm.dailyLimit} onChange={(v) => setProductForm((s) => ({ ...s, dailyLimit: Math.max(1, Math.trunc(Number(v || 1))) }))} />
              <TextInput className="stats-commerce-product-modal-timezone-input" label="时区" value={productForm.timezone} onChange={(e) => setProductForm((s) => ({ ...s, timezone: e.currentTarget.value || 'Asia/Shanghai' }))} />
            </Group>
          ) : null}
          {productForm.entitlementType === 'openclaw_subscription' ? (
            <>
              <Group className="stats-commerce-product-modal-line" align="end" grow>
                <TextInput className="stats-commerce-product-modal-openclaw-name" label="OpenClaw 密钥名" value={productForm.openclaw.externalName} onChange={(e) => setProductForm((s) => ({ ...s, openclaw: { ...s.openclaw, externalName: e.currentTarget.value } }))} />
                <Select className="stats-commerce-product-modal-openclaw-wallet" label="允许钱包" value={productForm.openclaw.allowWallet} onChange={(value) => setProductForm((s) => ({ ...s, openclaw: { ...s.openclaw, allowWallet: value === 'false' ? 'false' : 'true' } }))} data={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
              </Group>
              <Textarea className="stats-commerce-product-modal-openclaw-items" label="allowed_item_ids" placeholder="每行一个 item id，可留空" minRows={2} value={productForm.openclaw.allowedItemIdsText} onChange={(e) => setProductForm((s) => ({ ...s, openclaw: { ...s.openclaw, allowedItemIdsText: e.currentTarget.value } }))} />
              <Textarea className="stats-commerce-product-modal-openclaw-description" label="描述文案" minRows={3} value={productForm.openclaw.descriptionText} onChange={(e) => setProductForm((s) => ({ ...s, openclaw: { ...s.openclaw, descriptionText: e.currentTarget.value } }))} />
            </>
          ) : null}
          <Stack className="stats-commerce-product-modal-sku-list" gap={8}>
            <Group className="stats-commerce-product-modal-sku-header" justify="space-between" align="center">
              <Text className="stats-commerce-product-modal-sku-title" size="sm" fw={600}>规格（SKU）</Text>
              <Button
                className="stats-commerce-product-modal-sku-add"
                size="xs"
                variant="light"
                onClick={() => setProductForm((s) => {
                  const next = [...s.skus, createDefaultSkuForm(s.skus.length === 0)]
                  return { ...s, skus: next }
                })}
              >
                添加规格
              </Button>
            </Group>
            {productForm.skus.length === 0 ? (
              <Text className="stats-commerce-product-modal-sku-empty" size="xs" c="dimmed">未添加规格时，按商品主价格/库存售卖。</Text>
            ) : productForm.skus.map((sku, index) => (
              <InlinePanel className="stats-commerce-product-modal-sku-card" key={sku.id} padding="compact">
                <Stack className="stats-commerce-product-modal-sku-card-stack" gap={6}>
                  <Group className="stats-commerce-product-modal-sku-card-header" justify="space-between" align="center">
                    <Text className="stats-commerce-product-modal-sku-card-title" size="xs" fw={600}>规格 #{index + 1}</Text>
                    <Group className="stats-commerce-product-modal-sku-card-actions" gap={6}>
                      <Button
                        className="stats-commerce-product-modal-sku-default"
                        size="xs"
                        variant={sku.isDefault ? 'filled' : 'light'}
                        onClick={() => setProductForm((s) => ({
                          ...s,
                          skus: s.skus.map((x) => ({ ...x, isDefault: x.id === sku.id })),
                        }))}
                      >
                        {sku.isDefault ? '默认规格' : '设为默认'}
                      </Button>
                      <Button
                        className="stats-commerce-product-modal-sku-remove"
                        size="xs"
                        color="red"
                        variant="subtle"
                        onClick={() => setProductForm((s) => {
                          const next = s.skus.filter((x) => x.id !== sku.id)
                          if (next.length > 0 && !next.some((x) => x.isDefault)) next[0] = { ...next[0], isDefault: true }
                          return { ...s, skus: next }
                        })}
                      >
                        删除
                      </Button>
                    </Group>
                  </Group>
                  <Group className="stats-commerce-product-modal-sku-line" align="end" grow>
                    <TextInput className="stats-commerce-product-modal-sku-name" label="规格名" value={sku.name} onChange={(e) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, name: e.currentTarget.value } : x) }))} />
                    <TextInput className="stats-commerce-product-modal-sku-spec" label="规格描述" value={sku.spec} onChange={(e) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, spec: e.currentTarget.value } : x) }))} />
                    <Select className="stats-commerce-product-modal-sku-status" label="状态" value={sku.status} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, status: (v === 'active' || v === 'inactive' || v === 'draft') ? v : 'active' } : x) }))} data={[{ value: 'active', label: 'active' }, { value: 'draft', label: 'draft' }, { value: 'inactive', label: 'inactive' }]} />
                  </Group>
                  <Group className="stats-commerce-product-modal-sku-line" align="end" grow>
                    <NumberInput className="stats-commerce-product-modal-sku-price" label="价格(元)" min={0} decimalScale={2} fixedDecimalScale value={sku.priceYuan} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, priceYuan: Math.max(0, Number(v || 0)) } : x) }))} />
                    <NumberInput className="stats-commerce-product-modal-sku-stock" label="库存" min={0} value={sku.stock} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, stock: Math.max(0, Math.trunc(Number(v || 0))) } : x) }))} />
                  </Group>
                  {productForm.entitlementType === 'points_topup' ? (
                    <Group className="stats-commerce-product-modal-sku-line" align="end" grow>
                      <NumberInput className="stats-commerce-product-modal-sku-points" label="该规格基础积分" min={0} value={sku.points} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, points: Math.max(0, Math.trunc(Number(v || 0))) } : x) }))} />
                      <NumberInput className="stats-commerce-product-modal-sku-bonus" label="该规格赠送积分" min={0} value={sku.bonusPoints} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, bonusPoints: Math.max(0, Math.trunc(Number(v || 0))) } : x) }))} />
                    </Group>
                  ) : null}
                  {productForm.entitlementType === 'monthly_quota' || productForm.entitlementType === 'openclaw_subscription' ? (
                    <Group className="stats-commerce-product-modal-sku-line" align="end" grow>
                      <NumberInput className="stats-commerce-product-modal-sku-duration" label="该规格时长(天)" min={1} value={sku.durationDays} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, durationDays: Math.max(1, Math.trunc(Number(v || 30))) } : x) }))} />
                      <NumberInput className="stats-commerce-product-modal-sku-daily-limit" label="该规格日额度" min={1} value={sku.dailyLimit} onChange={(v) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, dailyLimit: Math.max(1, Math.trunc(Number(v || 1))) } : x) }))} />
                      <TextInput className="stats-commerce-product-modal-sku-timezone" label="该规格时区" value={sku.timezone} onChange={(e) => setProductForm((s) => ({ ...s, skus: s.skus.map((x) => x.id === sku.id ? { ...x, timezone: e.currentTarget.value || 'Asia/Shanghai' } : x) }))} />
                    </Group>
                  ) : null}
                </Stack>
              </InlinePanel>
            ))}
          </Stack>
          <Textarea className="stats-commerce-product-modal-description-input" label="商品描述" placeholder="可选" minRows={3} value={productForm.description} onChange={(e) => setProductForm((s) => ({ ...s, description: e.currentTarget.value }))} />
          <Group className="stats-commerce-product-modal-actions" justify="flex-end" gap="xs">
            <Button className="stats-commerce-product-modal-cancel" variant="subtle" onClick={() => setProductModalOpen(false)}>取消</Button>
            <Button className="stats-commerce-product-modal-submit" loading={submittingProductForm} onClick={() => void submitProductForm()}>{productModalMode === 'edit' ? '保存修改' : '创建商品'}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
