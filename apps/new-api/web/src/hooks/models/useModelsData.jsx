/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';

export const useModelsData = () => {
  const { t } = useTranslation();
  const [compactMode, setCompactMode] = useTableCompactMode('models');

  // State management
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [searching, setSearching] = useState(false);
  const [modelCount, setModelCount] = useState(0);
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);

  // Modal states
  const [showEdit, setShowEdit] = useState(false);
  const [editingModel, setEditingModel] = useState({
    id: undefined,
  });

  // Row selection
  const [selectedKeys, setSelectedKeys] = useState([]);
  const rowSelection = {
    getCheckboxProps: (record) => ({
      name: record.model_name,
    }),
    selectedRowKeys: selectedKeys.map((model) => model.id),
    onChange: (selectedRowKeys, selectedRows) => {
      setSelectedKeys(selectedRows);
    },
  };

  // Form initial values
  const formInitValues = {
    searchKeyword: '',
    searchVendor: '',
  };

  // ---------- helpers ----------
  // Safely extract array items from API payload
  const extractItems = (payload) => {
    const items = payload?.items || payload || [];
    return Array.isArray(items) ? items : [];
  };

  // Form API reference
  const [formApi, setFormApi] = useState(null);

  // Get form values helper function
  const getFormValues = () => formApi?.getValues() || formInitValues;

  // Close edit modal
  const closeEdit = () => {
    setShowEdit(false);
    setTimeout(() => {
      setEditingModel({ id: undefined });
    }, 500);
  };

  // Set model format with key field
  const setModelFormat = (models) => {
    for (let i = 0; i < models.length; i++) {
      models[i].key = models[i].id;
    }
    setModels(models);
  };

  // Vendor list
  const [vendors, setVendors] = useState([]);
  const [vendorCounts, setVendorCounts] = useState({});
  const [activeVendorKey, setActiveVendorKey] = useState('all');
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [showEditVendor, setShowEditVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState({ id: undefined });
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const vendorMap = useMemo(() => {
    const map = {};
    vendors.forEach((v) => {
      map[v.id] = v;
    });
    return map;
  }, [vendors]);

  // Load vendor list
  const loadVendors = async () => {
    try {
      const res = await API.get('/api/vendors/?page_size=1000');
      if (res.data.success) {
        const items = res.data.data.items || res.data.data || [];
        setVendors(Array.isArray(items) ? items : []);
      }
    } catch (_) {
      // ignore
    }
  };

  // Load models data
  const loadModels = async (
    page = 1,
    size = pageSize,
    vendorKey = activeVendorKey,
  ) => {
    setLoading(true);
    try {
      let url = `/api/models/?p=${page}&page_size=${size}`;
      if (vendorKey && vendorKey !== 'all') {
        // Filter by vendor ID
        url = `/api/models/search?vendor=${vendorKey}&p=${page}&page_size=${size}`;
      }

      const res = await API.get(url);
      const { success, message, data } = res.data;
      if (success) {
        const newPageData = extractItems(data);
        setActivePage(data.page || page);
        setModelCount(data.total || newPageData.length);
        setModelFormat(newPageData);

        if (data.vendor_counts) {
          const sumAll = Object.values(data.vendor_counts).reduce(
            (acc, v) => acc + v,
            0,
          );
          setVendorCounts({ ...data.vendor_counts, all: sumAll });
        }
      } else {
        showError(message);
        setModels([]);
      }
    } catch (error) {
      console.error(error);
      showError(t('获取模型列表失败'));
      setModels([]);
    }
    setLoading(false);
  };

  // Refresh data
  const refresh = async (page = activePage) => {
    await loadModels(page, pageSize);
  };

  // Sync upstream models/vendors for missing models only
  const syncUpstream = async (opts = {}) => {
    const locale = opts?.locale;
    setSyncing(true);
    try {
      const body = {};
      if (locale) body.locale = locale;
      const res = await API.post('/api/models/sync_upstream', body);
      const { success, message, data } = res.data || {};
      if (success) {
        const createdModels = data?.created_models || 0;
        const createdVendors = data?.created_vendors || 0;
        const skipped = (data?.skipped_models || []).length || 0;
        showSuccess(
          t(
            `已同步：新增 ${createdModels} 模型，新增 ${createdVendors} 供应商，跳过 ${skipped} 项`,
          ),
        );
        await loadVendors();
        await refresh();
      } else {
        showError(message || t('同步失败'));
      }
    } catch (e) {
      showError(t('同步失败'));
    }
    setSyncing(false);
  };

  // Preview upstream differences
  const previewUpstreamDiff = async (opts = {}) => {
    const locale = opts?.locale;
    setPreviewing(true);
    try {
      const url = `/api/models/sync_upstream/preview${locale ? `?locale=${locale}` : ''}`;
      const res = await API.get(url);
      const { success, message, data } = res.data || {};
      if (success) {
        return data || { missing: [], conflicts: [] };
      }
      showError(message || t('预览失败'));
      return { missing: [], conflicts: [] };
    } catch (e) {
      showError(t('预览失败'));
      return { missing: [], conflicts: [] };
    } finally {
      setPreviewing(false);
    }
  };

  // Apply selected overwrite
  const applyUpstreamOverwrite = async (payloadOrArray = []) => {
    const isArray = Array.isArray(payloadOrArray);
    const overwrite = isArray ? payloadOrArray : payloadOrArray.overwrite || [];
    const locale = isArray ? undefined : payloadOrArray.locale;
    setSyncing(true);
    try {
      const body = { overwrite };
      if (locale) body.locale = locale;
      const res = await API.post('/api/models/sync_upstream', body);
      const { success, message, data } = res.data || {};
      if (success) {
        const createdModels = data?.created_models || 0;
        const updatedModels = data?.updated_models || 0;
        const createdVendors = data?.created_vendors || 0;
        const skipped = (data?.skipped_models || []).length || 0;
        showSuccess(
          t(
            `完成：新增 ${createdModels} 模型，更新 ${updatedModels} 模型，新增 ${createdVendors} 供应商，跳过 ${skipped} 项`,
          ),
        );
        await loadVendors();
        await refresh();
        return true;
      }
      showError(message || t('同步失败'));
      return false;
    } catch (e) {
      showError(t('同步失败'));
      return false;
    } finally {
      setSyncing(false);
    }
  };

  // Search models with keyword and vendor
  const searchModels = async (page = 1, size = pageSize) => {
    // onSubmit / 事件回调可能传入非数字的首参（如表单 values），归一化避免污染分页参数
    const targetPage = typeof page === 'number' ? page : 1;
    const targetSize = typeof size === 'number' ? size : pageSize;
    const { searchKeyword = '', searchVendor = '' } = getFormValues();

    if (searchKeyword === '' && searchVendor === '') {
      // If keyword is blank, load models instead
      await loadModels(targetPage, targetSize);
      return;
    }

    setSearching(true);
    try {
      const res = await API.get(
        `/api/models/search?keyword=${searchKeyword}&vendor=${searchVendor}&p=${targetPage}&page_size=${targetSize}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        const newPageData = extractItems(data);
        setActivePage(data.page || targetPage);
        setModelCount(data.total || newPageData.length);
        setModelFormat(newPageData);
        if (data.vendor_counts) {
          const sumAll = Object.values(data.vendor_counts).reduce(
            (acc, v) => acc + v,
            0,
          );
          setVendorCounts({ ...data.vendor_counts, all: sumAll });
        }
      } else {
        showError(message);
        setModels([]);
      }
    } catch (error) {
      console.error(error);
      showError(t('搜索模型失败'));
      setModels([]);
    }
    setSearching(false);
  };

  // Manage model (enable/disable/delete)
  const manageModel = async (id, action, record) => {
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/models/${id}`);
        break;
      case 'enable':
        res = await API.put('/api/models/?status_only=true', { id, status: 1 });
        break;
      case 'disable':
        res = await API.put('/api/models/?status_only=true', { id, status: 0 });
        break;
      default:
        return;
    }

    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      if (action === 'delete') {
        await refresh();
      } else {
        // Update local state for enable/disable
        setModels((prevModels) =>
          prevModels.map((model) =>
            model.id === id
              ? { ...model, status: action === 'enable' ? 1 : 0 }
              : model,
          ),
        );
      }
    } else {
      showError(message);
    }
  };

  // Handle page change
  const handlePageChange = (page) => {
    setActivePage(page);
    const { searchKeyword = '', searchVendor = '' } = getFormValues();
    if (searchKeyword === '' && searchVendor === '') {
      loadModels(page, pageSize, activeVendorKey);
    } else {
      // 翻页时保留搜索关键字 / 供应商筛选条件
      searchModels(page, pageSize);
    }
  };

  // Reload models when activeVendorKey changes
  useEffect(() => {
    loadModels(1, pageSize, activeVendorKey);
  }, [activeVendorKey]);

  // Handle page size change
  const handlePageSizeChange = async (size) => {
    setPageSize(size);
    setActivePage(1);
    const { searchKeyword = '', searchVendor = '' } = getFormValues();
    if (searchKeyword === '' && searchVendor === '') {
      await loadModels(1, size, activeVendorKey);
    } else {
      // 改变每页数量时保留搜索关键字 / 供应商筛选条件
      await searchModels(1, size);
    }
  };

  // Handle row click and styling
  const handleRow = (record, index) => {
    const rowStyle =
      record.status !== 1
        ? {
            style: {
              background: 'var(--semi-color-disabled-border)',
            },
          }
        : {};

    return {
      ...rowStyle,
      onClick: (event) => {
        // Don't trigger row selection when clicking on buttons
        if (event.target.closest('button, .semi-button')) {
          return;
        }
        const newSelectedKeys = selectedKeys.some(
          (item) => item.id === record.id,
        )
          ? selectedKeys.filter((item) => item.id !== record.id)
          : [...selectedKeys, record];
        setSelectedKeys(newSelectedKeys);
      },
    };
  };

  // Batch delete models
  const batchDeleteModels = async () => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个模型'));
      return;
    }

    try {
      const deletePromises = selectedKeys.map((model) =>
        API.delete(`/api/models/${model.id}`),
      );

      const results = await Promise.all(deletePromises);
      let successCount = 0;

      results.forEach((res, index) => {
        if (res.data.success) {
          successCount++;
        } else {
          showError(
            `删除模型 ${selectedKeys[index].model_name} 失败: ${res.data.message}`,
          );
        }
      });

      if (successCount > 0) {
        showSuccess(t(`成功删除 ${successCount} 个模型`));
        setSelectedKeys([]);
        await refresh();
      }
    } catch (error) {
      showError(t('批量删除失败'));
    }
  };

  const batchUpdateModelStatus = async (status) => {
    if (selectedKeys.length === 0) {
      showError(t('请至少选择一个模型'));
      return false;
    }
    if (status !== 0 && status !== 1) {
      showError(t('模型状态只能是启用或禁用'));
      return false;
    }

    setBatchStatusUpdating(true);
    try {
      const ids = selectedKeys.map((selectedModel) => selectedModel.id);
      const res = await API.patch('/api/models/status', { ids, status });
      const { success, message, data } = res.data || {};
      if (!success) {
        showError(message || t('批量更新模型状态失败'));
        return false;
      }

      const updatedCount = data?.updated_count ?? 0;
      const selectedIDSet = new Set(ids);
      setModels((currentModels) =>
        currentModels.map((currentModel) =>
          selectedIDSet.has(currentModel.id)
            ? { ...currentModel, status }
            : currentModel,
        ),
      );
      setSelectedKeys([]);
      showSuccess(
        status === 1
          ? t('已启用 {{count}} 个模型', { count: updatedCount })
          : t('已禁用 {{count}} 个模型', { count: updatedCount }),
      );
      return true;
    } catch (error) {
      console.error(error);
      showError(t('批量更新模型状态失败'));
      return false;
    } finally {
      setBatchStatusUpdating(false);
    }
  };

  // Copy text helper
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(t('复制成功'));
    } catch (error) {
      console.error('Copy failed:', error);
      showError(t('复制失败'));
    }
  };

  // Initial load
  useEffect(() => {
    (async () => {
      await loadVendors();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // Data state
    models,
    loading,
    searching,
    activePage,
    pageSize,
    modelCount,

    // Selection state
    selectedKeys,
    rowSelection,
    handleRow,
    setSelectedKeys,

    // Modal state
    showEdit,
    editingModel,
    setEditingModel,
    setShowEdit,
    closeEdit,

    // Form state
    formInitValues,
    setFormApi,

    // Actions
    loadModels,
    searchModels,
    refresh,
    manageModel,
    batchDeleteModels,
    batchUpdateModelStatus,
    copyText,

    // Pagination
    setActivePage,
    handlePageChange,
    handlePageSizeChange,

    // UI state
    compactMode,
    setCompactMode,
    batchStatusUpdating,

    // Vendor data
    vendors,
    vendorMap,
    vendorCounts,
    activeVendorKey,
    setActiveVendorKey,
    showAddVendor,
    setShowAddVendor,
    showEditVendor,
    setShowEditVendor,
    editingVendor,
    setEditingVendor,
    loadVendors,

    // Translation
    t,

    // Upstream sync
    syncing,
    previewing,
    syncUpstream,
    previewUpstreamDiff,
    applyUpstreamOverwrite,
  };
};
