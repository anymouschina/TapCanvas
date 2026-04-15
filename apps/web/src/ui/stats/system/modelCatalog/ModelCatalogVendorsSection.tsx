import React from 'react'
import { ActionIcon, Button, Group, Loader, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconKey, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import type { ModelCatalogVendorDto } from './deps'
import { ApiKeyStatusBadge, EnabledBadge } from './ModelCatalogBadges'
import { ModelCatalogTableFooter } from './ModelCatalogTableFooter'
import { includesSearchText, paginateItems } from './modelCatalog.utils'

export function ModelCatalogVendorsSection({
  loading,
  vendors,
  onCreateVendor,
  onEditVendor,
  onDeleteVendor,
  onOpenVendorApiKey,
}: {
  loading: boolean
  vendors: ModelCatalogVendorDto[]
  onCreateVendor: () => void
  onEditVendor: (vendor: ModelCatalogVendorDto) => void
  onDeleteVendor: (vendor: ModelCatalogVendorDto) => void
  onOpenVendorApiKey: (vendor: ModelCatalogVendorDto) => void
}): JSX.Element {
  const [keywordInput, setKeywordInput] = React.useState('')
  const [keyword, setKeyword] = React.useState('')
  const [enabledOnlyInput, setEnabledOnlyInput] = React.useState(false)
  const [enabledOnly, setEnabledOnly] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  const filteredVendors = React.useMemo(() => {
    let items = [...vendors]
    if (enabledOnly) items = items.filter((vendor) => !!vendor.enabled)
    if (keyword) {
      items = items.filter((vendor) =>
        includesSearchText([vendor.key, vendor.name, vendor.baseUrlHint, vendor.authType], keyword),
      )
    }
    return items
  }, [enabledOnly, keyword, vendors])

  const pagedVendors = React.useMemo(
    () => paginateItems(filteredVendors, page, pageSize),
    [filteredVendors, page, pageSize],
  )

  React.useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredVendors.length / pageSize))
    if (page > totalPages) setPage(totalPages)
  }, [filteredVendors.length, page, pageSize])

  const submitSearch = React.useCallback(() => {
    setKeyword(keywordInput)
    setEnabledOnly(enabledOnlyInput)
    setPage(1)
  }, [enabledOnlyInput, keywordInput])

  const resetSearch = React.useCallback(() => {
    setKeywordInput('')
    setKeyword('')
    setEnabledOnlyInput(false)
    setEnabledOnly(false)
    setPage(1)
  }, [])

  return (
    <div className="stats-model-catalog-vendors-panel">
      <Group className="stats-model-catalog-vendor-search" gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          className="stats-model-catalog-vendor-search-keyword"
          label="搜索"
          placeholder="搜索厂商 key / 名称 / BaseUrl"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.currentTarget.value)}
          leftSection={<IconSearch className="stats-model-catalog-vendor-search-keyword-icon" size={14} />}
          w={320}
        />
        <Switch
          className="stats-model-catalog-vendor-search-enabled"
          checked={enabledOnlyInput}
          onChange={(event) => setEnabledOnlyInput(event.currentTarget.checked)}
          label="仅看启用厂商"
          mb={4}
        />
        <Group className="stats-model-catalog-vendor-search-actions" gap={8} mb={4}>
          <Button className="stats-model-catalog-vendor-search-submit" size="xs" onClick={submitSearch}>
            查询
          </Button>
          <Button className="stats-model-catalog-vendor-search-reset" size="xs" variant="subtle" onClick={resetSearch}>
            重置
          </Button>
          <Button className="stats-model-catalog-vendor-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-vendor-create-icon" size={14} />} onClick={onCreateVendor}>
            新增厂商
          </Button>
        </Group>
      </Group>

      <div className="stats-model-catalog-vendors-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-vendors-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-vendors-table-head">
            <Table.Tr className="stats-model-catalog-vendors-table-head-row">
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 140 }}>Key</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 180 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 110 }}>API Key</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 160 }}>鉴权</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell">BaseUrl Hint</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 160 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-vendors-table-body">
            {loading && !vendors.length ? (
              <Table.Tr className="stats-model-catalog-vendors-table-row-loading">
                <Table.Td className="stats-model-catalog-vendors-table-cell" colSpan={7}>
                  <Group className="stats-model-catalog-loading" gap="xs" align="center">
                    <Loader className="stats-model-catalog-loading-icon" size="sm" />
                    <Text className="stats-model-catalog-loading-text" size="sm" c="dimmed">加载中…</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ) : !pagedVendors.length ? (
              <Table.Tr className="stats-model-catalog-vendors-table-row-empty">
                <Table.Td className="stats-model-catalog-vendors-table-cell" colSpan={7}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无厂商</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedVendors.map((vendor) => (
                <Table.Tr className="stats-model-catalog-vendors-table-row" key={vendor.key}>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-key" size="sm" fw={600}>{vendor.key}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-name" size="sm">{vendor.name}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <EnabledBadge enabled={!!vendor.enabled} />
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <ApiKeyStatusBadge hasApiKey={Boolean(vendor.hasApiKey)} />
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-auth" size="sm" c="dimmed">{String(vendor.authType || 'bearer')}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-baseurl" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{(vendor.baseUrlHint || '').trim() || '—'}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Group className="stats-model-catalog-vendor-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Tooltip className="stats-model-catalog-vendor-apikey-tooltip" label="设置系统级全局 API Key（不回显）" withArrow>
                        <ActionIcon className="stats-model-catalog-vendor-apikey" size="sm" variant="light" aria-label="vendor-api-key" onClick={() => onOpenVendorApiKey(vendor)}>
                          <IconKey className="stats-model-catalog-vendor-apikey-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Button className="stats-model-catalog-vendor-edit" size="xs" variant="light" onClick={() => onEditVendor(vendor)}>编辑</Button>
                      <ActionIcon className="stats-model-catalog-vendor-delete" size="sm" variant="light" color="red" aria-label="delete-vendor" onClick={() => void onDeleteVendor(vendor)}>
                        <IconTrash className="stats-model-catalog-vendor-delete-icon" size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>

      <ModelCatalogTableFooter
        total={filteredVendors.length}
        page={page}
        pageSize={pageSize}
        onChangePage={setPage}
        onChangePageSize={(next) => {
          setPageSize(next)
          setPage(1)
        }}
      />
    </div>
  )
}
