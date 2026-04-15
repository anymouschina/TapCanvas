import React from 'react'
import { ActionIcon, Button, Divider, Group, Loader, Select, Switch, Table, Text } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { ModelCatalogMappingDto, ProfileKind } from './deps'
import { EnabledBadge } from './ModelCatalogBadges'
import { ModelCatalogTableFooter } from './ModelCatalogTableFooter'
import { TASK_KIND_OPTIONS } from './modelCatalog.constants'
import { formatTaskKind, paginateItems, prettyJson } from './modelCatalog.utils'

export function ModelCatalogMappingsSection({
  loading,
  mappings,
  vendorSelectData,
  onCreateMapping,
  onEditMapping,
  onDeleteMapping,
}: {
  loading: boolean
  mappings: ModelCatalogMappingDto[]
  vendorSelectData: Array<{ value: string; label: string }>
  onCreateMapping: () => void
  onEditMapping: (mapping: ModelCatalogMappingDto) => void
  onDeleteMapping: (mapping: ModelCatalogMappingDto) => void
}): JSX.Element {
  const [vendorFilterInput, setVendorFilterInput] = React.useState<string>('all')
  const [taskKindFilterInput, setTaskKindFilterInput] = React.useState<ProfileKind | 'all'>('all')
  const [enabledOnlyInput, setEnabledOnlyInput] = React.useState(false)

  const [vendorFilter, setVendorFilter] = React.useState<string>('all')
  const [taskKindFilter, setTaskKindFilter] = React.useState<ProfileKind | 'all'>('all')
  const [enabledOnly, setEnabledOnly] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  const filteredMappings = React.useMemo(() => {
    let items = [...mappings]
    if (vendorFilter !== 'all') items = items.filter((mapping) => mapping.vendorKey === vendorFilter)
    if (taskKindFilter !== 'all') items = items.filter((mapping) => mapping.taskKind === taskKindFilter)
    if (enabledOnly) items = items.filter((mapping) => !!mapping.enabled)
    return items
  }, [enabledOnly, mappings, taskKindFilter, vendorFilter])

  const pagedMappings = React.useMemo(
    () => paginateItems(filteredMappings, page, pageSize),
    [filteredMappings, page, pageSize],
  )

  React.useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMappings.length / pageSize))
    if (page > totalPages) setPage(totalPages)
  }, [filteredMappings.length, page, pageSize])

  const submitSearch = React.useCallback(() => {
    setVendorFilter(vendorFilterInput)
    setTaskKindFilter(taskKindFilterInput)
    setEnabledOnly(enabledOnlyInput)
    setPage(1)
  }, [enabledOnlyInput, taskKindFilterInput, vendorFilterInput])

  const resetSearch = React.useCallback(() => {
    setVendorFilterInput('all')
    setTaskKindFilterInput('all')
    setEnabledOnlyInput(false)
    setVendorFilter('all')
    setTaskKindFilter('all')
    setEnabledOnly(false)
    setPage(1)
  }, [])

  return (
    <>
      <Divider className="stats-model-catalog-divider" label="字段映射（Transform）" labelPosition="left" />
      <Group className="stats-model-catalog-mapping-search" gap="sm" wrap="wrap" align="flex-end">
        <Select
          className="stats-model-catalog-mapping-search-taskkind"
          label="任务类型"
          value={taskKindFilterInput}
          onChange={(value) => setTaskKindFilterInput(((value as ProfileKind | 'all' | null) || 'all'))}
          data={[{ value: 'all', label: '全部任务类型' }, ...TASK_KIND_OPTIONS]}
          w={240}
        />
        <Select
          className="stats-model-catalog-mapping-search-vendor"
          label="厂商"
          value={vendorFilterInput}
          onChange={(value) => setVendorFilterInput(value || 'all')}
          data={vendorSelectData}
          searchable
          w={220}
        />
        <Switch
          className="stats-model-catalog-mapping-search-enabled"
          checked={enabledOnlyInput}
          onChange={(event) => setEnabledOnlyInput(event.currentTarget.checked)}
          label="仅看启用映射"
          mb={4}
        />
        <Group className="stats-model-catalog-mapping-search-actions" gap={8} mb={4}>
          <Button className="stats-model-catalog-mapping-search-submit" size="xs" onClick={submitSearch}>
            查询
          </Button>
          <Button className="stats-model-catalog-mapping-search-reset" size="xs" variant="subtle" onClick={resetSearch}>
            重置
          </Button>
          <Button className="stats-model-catalog-mapping-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-mapping-create-icon" size={14} />} onClick={onCreateMapping}>
            新增映射
          </Button>
        </Group>
      </Group>

      <div className="stats-model-catalog-mappings-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-mappings-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-mappings-table-head">
            <Table.Tr className="stats-model-catalog-mappings-table-head-row">
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 120 }}>厂商</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 170 }}>任务类型</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 180 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Request</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Response</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-mappings-table-body">
            {loading && !mappings.length ? (
              <Table.Tr className="stats-model-catalog-mappings-table-row-loading">
                <Table.Td className="stats-model-catalog-mappings-table-cell" colSpan={7}>
                  <Group className="stats-model-catalog-loading" gap="xs" align="center">
                    <Loader className="stats-model-catalog-loading-icon" size="sm" />
                    <Text className="stats-model-catalog-loading-text" size="sm" c="dimmed">加载中…</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ) : !pagedMappings.length ? (
              <Table.Tr className="stats-model-catalog-mappings-table-row-empty">
                <Table.Td className="stats-model-catalog-mappings-table-cell" colSpan={7}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无映射</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedMappings.map((mapping) => (
                <Table.Tr className="stats-model-catalog-mappings-table-row" key={mapping.id}>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-vendor" size="sm" fw={600}>{mapping.vendorKey}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-taskkind" size="sm" c="dimmed">{formatTaskKind(mapping.taskKind)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-name" size="sm">
                      {mapping.name}
                      {((mapping.requestMapping as { version?: unknown } | null | undefined)?.version === 'v2' || (mapping.responseMapping as { version?: unknown } | null | undefined)?.version === 'v2') ? ' · V2' : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <EnabledBadge enabled={!!mapping.enabled} />
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-request" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mapping.requestMapping ? prettyJson(mapping.requestMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-response" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mapping.responseMapping ? prettyJson(mapping.responseMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Group className="stats-model-catalog-mapping-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Button className="stats-model-catalog-mapping-edit" size="xs" variant="light" onClick={() => onEditMapping(mapping)}>编辑</Button>
                      <ActionIcon className="stats-model-catalog-mapping-delete" size="sm" variant="light" color="red" aria-label="delete-mapping" onClick={() => void onDeleteMapping(mapping)}>
                        <IconTrash className="stats-model-catalog-mapping-delete-icon" size={14} />
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
        total={filteredMappings.length}
        page={page}
        pageSize={pageSize}
        onChangePage={setPage}
        onChangePageSize={(next) => {
          setPageSize(next)
          setPage(1)
        }}
      />
    </>
  )
}
