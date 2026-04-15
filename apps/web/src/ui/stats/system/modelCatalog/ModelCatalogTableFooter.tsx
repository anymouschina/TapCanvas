import React from 'react'
import { Group, Pagination, Select, Text } from '@mantine/core'
import { PAGE_SIZE_OPTIONS } from './modelCatalog.constants'

export function ModelCatalogTableFooter({
  total,
  page,
  pageSize,
  onChangePage,
  onChangePageSize,
}: {
  total: number
  page: number
  pageSize: number
  onChangePage: (next: number) => void
  onChangePageSize: (next: number) => void
}): JSX.Element | null {
  if (total <= 0) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Group className="stats-model-catalog-table-footer" justify="space-between" align="center" mt="sm" gap="sm" wrap="wrap">
      <Text className="stats-model-catalog-table-footer-summary" size="xs" c="dimmed">
        共 {total} 条
      </Text>
      <Group className="stats-model-catalog-table-footer-controls" gap="sm" align="center" wrap="wrap">
        <Select
          className="stats-model-catalog-table-footer-page-size"
          value={String(pageSize)}
          data={PAGE_SIZE_OPTIONS}
          onChange={(value) => onChangePageSize(Number.parseInt(String(value || pageSize), 10))}
          allowDeselect={false}
          w={100}
        />
        <Pagination
          className="stats-model-catalog-table-footer-pagination"
          value={Math.min(page, totalPages)}
          onChange={onChangePage}
          total={totalPages}
          size="sm"
        />
      </Group>
    </Group>
  )
}
