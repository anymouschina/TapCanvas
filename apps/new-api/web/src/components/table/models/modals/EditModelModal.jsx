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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Banner,
  Button,
  Col,
  Form,
  Row,
  SideSheet,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconLink, IconSave } from '@douyinfe/semi-icons';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import JSONEditor from '../../../common/ui/JSONEditor';
import { API, showError, showSuccess } from '../../../../helpers';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import { useProtocolCatalog } from '../../../../hooks/models/useProtocolCatalog';
import ModelProtocolEditor from '../components/ModelProtocolEditor';
import ModelPricingEditorPanel from '../components/ModelPricingEditorPanel';

const { Text, Title } = Typography;

const ENDPOINT_TEMPLATE = {
  openai: { path: '/v1/chat/completions', method: 'POST' },
  'openai-response': { path: '/v1/responses', method: 'POST' },
  'openai-response-compact': {
    path: '/v1/responses/compact',
    method: 'POST',
  },
  anthropic: { path: '/v1/messages', method: 'POST' },
  gemini: { path: '/v1beta/models/{model}:generateContent', method: 'POST' },
  'jina-rerank': { path: '/v1/rerank', method: 'POST' },
  'image-generation': { path: '/v1/images/generations', method: 'POST' },
  embeddings: { path: '/v1/embeddings', method: 'POST' },
};

const NAME_RULE_OPTIONS = [
  { label: '精确名称匹配', value: 0 },
  { label: '前缀名称匹配', value: 1 },
  { label: '包含名称匹配', value: 2 },
  { label: '后缀名称匹配', value: 3 },
];

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags.flatMap((tag) =>
        String(tag)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ),
  ];
};

const readSuccessfulArrayResponse = (response, label, allowPage = false) => {
  if (!response?.data?.success) {
    throw new Error(response?.data?.message || `${label}加载失败`);
  }
  const data = response.data.data;
  const items = allowPage ? data?.items || data : data;
  if (!Array.isArray(items)) {
    throw new Error(`${label}返回格式无效`);
  }
  return items;
};

const EditModelModal = (props) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const formApiRef = useRef(null);
  const isEdit = props.editingModel?.id !== undefined;
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState('');
  const [referenceDataError, setReferenceDataError] = useState('');
  const [loadedModel, setLoadedModel] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [tagGroups, setTagGroups] = useState([]);
  const [endpointGroups, setEndpointGroups] = useState([]);
  const {
    protocols,
    loading: protocolCatalogLoading,
    error: protocolCatalogError,
  } = useProtocolCatalog(props.visiable && isEdit);

  const getInitValues = useCallback(
    () => ({
      model_name: props.editingModel?.model_name || '',
      description: '',
      icon: '',
      tags: [],
      vendor_id: undefined,
      endpoints: '',
      pricing_config: '',
      kind: '',
      capabilities: '',
      params_def: '',
      name_rule: props.editingModel?.model_name ? 0 : undefined,
      status: true,
      sync_official: true,
    }),
    [props.editingModel?.model_name],
  );

  const fetchReferenceData = useCallback(async () => {
    setReferenceDataError('');
    try {
      const [vendorResponse, tagResponse, endpointResponse] = await Promise.all(
        [
          API.get('/api/vendors/?page_size=1000'),
          API.get('/api/prefill_group?type=tag'),
          API.get('/api/prefill_group?type=endpoint'),
        ],
      );
      setVendors(
        readSuccessfulArrayResponse(vendorResponse, t('供应商'), true),
      );
      setTagGroups(readSuccessfulArrayResponse(tagResponse, t('标签预设')));
      setEndpointGroups(
        readSuccessfulArrayResponse(endpointResponse, t('端点预设')),
      );
    } catch (requestError) {
      const message =
        requestError?.response?.data?.message ||
        requestError.message ||
        t('模型编辑数据加载失败');
      setVendors([]);
      setTagGroups([]);
      setEndpointGroups([]);
      setReferenceDataError(message);
      showError(message);
    }
  }, [t]);

  const loadModel = useCallback(async () => {
    if (!isEdit || !props.editingModel?.id) return;
    setLoading(true);
    setModelLoadError('');
    try {
      const response = await API.get(`/api/models/${props.editingModel.id}`);
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('加载模型信息失败'));
      }
      const modelData = response.data.data;
      setLoadedModel(modelData);
      formApiRef.current?.setValues({
        ...getInitValues(),
        ...modelData,
        tags: modelData.tags ? modelData.tags.split(',').filter(Boolean) : [],
        endpoints: modelData.endpoints || '',
        pricing_config: modelData.pricing_config || '',
        status: modelData.status === 1,
        sync_official: (modelData.sync_official ?? 1) === 1,
      });
    } catch (requestError) {
      const message =
        requestError?.response?.data?.message ||
        requestError.message ||
        t('加载模型信息失败');
      setLoadedModel(null);
      setModelLoadError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [getInitValues, isEdit, props.editingModel?.id, t]);

  useEffect(() => {
    if (!props.visiable) {
      formApiRef.current?.reset();
      setLoadedModel(null);
      setModelLoadError('');
      setReferenceDataError('');
      return;
    }
    setActiveTab('overview');
    fetchReferenceData();
    if (isEdit) {
      loadModel();
    } else {
      const initialValues = getInitValues();
      setLoadedModel(initialValues);
      formApiRef.current?.setValues(initialValues);
    }
  }, [fetchReferenceData, getInitValues, isEdit, loadModel, props.visiable]);

  const submit = async (values) => {
    if (modelLoadError || referenceDataError) {
      showError(
        `${t('模型编辑上下文不完整，禁止保存')}: ${
          modelLoadError || referenceDataError
        }`,
      );
      return;
    }
    setLoading(true);
    try {
      const submitData = {
        ...values,
        id: isEdit ? props.editingModel.id : undefined,
        tags: normalizeTags(values.tags).join(','),
        endpoints: values.endpoints || '',
        pricing_config:
          loadedModel?.pricing_config || values.pricing_config || '',
        kind: loadedModel?.kind || values.kind || '',
        capabilities: loadedModel?.capabilities || values.capabilities || '',
        params_def: loadedModel?.params_def || values.params_def || '',
        status: values.status ? 1 : 0,
        sync_official: values.sync_official ? 1 : 0,
      };
      const response = isEdit
        ? await API.put('/api/models/', submitData)
        : await API.post('/api/models/', submitData);
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('保存模型失败'));
      }
      showSuccess(isEdit ? t('模型信息已更新') : t('模型创建成功'));
      await props.refresh();
      if (isEdit) {
        await loadModel();
      } else {
        props.handleClose();
      }
    } catch (requestError) {
      showError(
        requestError?.response?.data?.message ||
          requestError.message ||
          t('保存模型失败'),
      );
    } finally {
      setLoading(false);
    }
  };

  const applyEndpointGroup = (group) => {
    try {
      const current = formApiRef.current?.getValue('endpoints') || '';
      const currentObject = current.trim() ? JSON.parse(current) : {};
      const groupObject =
        typeof group.items === 'string'
          ? JSON.parse(group.items || '{}')
          : group.items || {};
      formApiRef.current?.setValue(
        'endpoints',
        JSON.stringify({ ...currentObject, ...groupObject }, null, 2),
      );
    } catch (parseError) {
      showError(`${t('端点配置 JSON 无效')}: ${parseError.message}`);
    }
  };

  const metadataTabActive =
    activeTab === 'overview' || activeTab === 'advanced';

  return (
    <SideSheet
      className='model-control-sheet'
      placement={isEdit ? 'right' : 'left'}
      title={
        <div className='model-control-sheet-title flex items-center gap-3'>
          <Tag className='model-control-sheet-mode' color='blue'>
            {isEdit ? t('编辑') : t('新建')}
          </Tag>
          <div className='model-control-sheet-heading min-w-0'>
            <Title
              className='model-control-sheet-title-text m-0 truncate'
              heading={4}
            >
              {isEdit
                ? loadedModel?.model_name || props.editingModel?.model_name
                : t('创建模型')}
            </Title>
            {isEdit ? (
              <Text className='model-control-sheet-subtitle block text-xs !text-semi-color-text-2'>
                {t('元数据、渠道协议与定价统一控制')}
              </Text>
            ) : null}
          </div>
        </div>
      }
      visible={props.visiable}
      width={isMobile ? '100%' : 720}
      bodyStyle={{ padding: 0 }}
      closeIcon={null}
      onCancel={props.handleClose}
      footer={
        <div className='model-control-sheet-footer flex justify-end gap-2'>
          {metadataTabActive ? (
            <Button
              className='model-control-sheet-submit'
              theme='solid'
              type='primary'
              icon={<IconSave className='model-control-sheet-submit-icon' />}
              loading={loading}
              disabled={Boolean(modelLoadError || referenceDataError)}
              onClick={() => formApiRef.current?.submitForm()}
            >
              {isEdit ? t('保存模型信息') : t('创建模型')}
            </Button>
          ) : null}
          <Button
            className='model-control-sheet-close'
            theme='borderless'
            icon={<X className='model-control-sheet-close-icon' size={16} />}
            onClick={props.handleClose}
          >
            {t('关闭')}
          </Button>
        </div>
      }
    >
      <Spin className='model-control-sheet-loading' spinning={loading}>
        <Form
          className='model-control-form'
          initValues={getInitValues()}
          getFormApi={(api) => {
            formApiRef.current = api;
          }}
          onSubmit={submit}
        >
          {({ values }) => (
            <div className='model-control-form-content'>
              {modelLoadError ? (
                <Banner
                  className='model-control-load-error mx-6 mt-5'
                  type='danger'
                  closeIcon={null}
                  description={`${t('模型信息加载失败，当前表单已锁定')}: ${modelLoadError}`}
                />
              ) : null}
              {referenceDataError ? (
                <Banner
                  className='model-control-reference-error mx-6 mt-5'
                  type='danger'
                  closeIcon={null}
                  description={`${t('模型编辑数据加载失败，当前表单已锁定')}: ${referenceDataError}`}
                />
              ) : null}
              <Tabs
                className='model-control-tabs'
                activeKey={activeTab}
                onChange={setActiveTab}
                keepDOM
              >
                <Tabs.TabPane
                  className='model-control-tab-overview'
                  itemKey='overview'
                  tab={t('概览')}
                >
                  <div className='model-control-section px-6 py-5'>
                    <Row className='model-control-overview-grid' gutter={16}>
                      <Col className='model-control-field' span={24}>
                        <Form.Input
                          className='model-control-name'
                          field='model_name'
                          label={t('模型名称')}
                          placeholder={t('例如 gpt-4.1')}
                          rules={[
                            { required: true, message: t('请输入模型名称') },
                          ]}
                          disabled={isEdit}
                          extraText={
                            isEdit
                              ? t(
                                  '模型名称是渠道协议、能力和定价的稳定键；如需新名称，请新建模型。',
                                )
                              : undefined
                          }
                          showClear
                        />
                      </Col>
                      <Col className='model-control-field' span={24}>
                        <Form.Select
                          className='model-control-name-rule'
                          field='name_rule'
                          label={t('名称匹配类型')}
                          optionList={NAME_RULE_OPTIONS.map((option) => ({
                            ...option,
                            label: t(option.label),
                          }))}
                          rules={[
                            {
                              required: true,
                              message: t('请选择名称匹配类型'),
                            },
                          ]}
                          extraText={t(
                            '精确模型可独立配置协议与定价；规则模型仅汇总匹配结果。',
                          )}
                          style={{ width: '100%' }}
                        />
                      </Col>
                      <Col className='model-control-field' span={24}>
                        <Form.Select
                          className='model-control-vendor'
                          field='vendor_id'
                          label={t('供应商')}
                          placeholder={t('选择模型供应商')}
                          optionList={vendors.map((vendor) => ({
                            label: vendor.name,
                            value: vendor.id,
                          }))}
                          filter
                          showClear
                          style={{ width: '100%' }}
                        />
                      </Col>
                      <Col className='model-control-field' span={24}>
                        <Form.TextArea
                          className='model-control-description'
                          field='description'
                          label={t('描述')}
                          placeholder={t('简要说明模型能力与适用场景')}
                          rows={3}
                          showClear
                        />
                      </Col>
                      <Col className='model-control-field' span={24}>
                        <Form.TagInput
                          className='model-control-tags'
                          field='tags'
                          label={t('标签')}
                          placeholder={t('输入标签，回车确认')}
                          addOnBlur
                          showClear
                          onChange={(tags) =>
                            formApiRef.current?.setValue(
                              'tags',
                              normalizeTags(tags),
                            )
                          }
                          extraText={
                            tagGroups.length > 0 ? (
                              <Space className='model-control-tag-presets' wrap>
                                {tagGroups.map((group) => (
                                  <Button
                                    className='model-control-tag-preset'
                                    key={group.id}
                                    size='small'
                                    theme='borderless'
                                    onClick={() => {
                                      const currentTags =
                                        formApiRef.current?.getValue('tags') ||
                                        [];
                                      formApiRef.current?.setValue(
                                        'tags',
                                        normalizeTags([
                                          ...currentTags,
                                          ...(group.items || []),
                                        ]),
                                      );
                                    }}
                                  >
                                    {group.name}
                                  </Button>
                                ))}
                              </Space>
                            ) : null
                          }
                        />
                      </Col>
                      <Col className='model-control-switch-field' span={12}>
                        <Form.Switch
                          className='model-control-sync'
                          field='sync_official'
                          label={t('参与官方同步')}
                        />
                      </Col>
                      <Col className='model-control-switch-field' span={12}>
                        <Form.Switch
                          className='model-control-status'
                          field='status'
                          label={t('启用模型')}
                        />
                      </Col>
                    </Row>
                  </div>
                </Tabs.TabPane>

                <Tabs.TabPane
                  className='model-control-tab-protocols'
                  itemKey='protocols'
                  tab={t('渠道协议')}
                  disabled={!isEdit || !loadedModel || Boolean(modelLoadError)}
                >
                  <div className='model-control-section px-6 py-5'>
                    <ModelProtocolEditor
                      model={loadedModel}
                      protocols={protocols}
                      catalogLoading={protocolCatalogLoading}
                      catalogError={protocolCatalogError}
                      onSaved={async () => {
                        await loadModel();
                        await props.refresh();
                      }}
                      t={t}
                    />
                  </div>
                </Tabs.TabPane>

                <Tabs.TabPane
                  className='model-control-tab-pricing'
                  itemKey='pricing'
                  tab={t('定价')}
                  disabled={!isEdit || !loadedModel || Boolean(modelLoadError)}
                >
                  <div className='model-control-section px-6 py-5'>
                    <ModelPricingEditorPanel
                      model={loadedModel}
                      onSaved={async () => {
                        await loadModel();
                        await props.refresh();
                      }}
                      t={t}
                    />
                  </div>
                </Tabs.TabPane>

                <Tabs.TabPane
                  className='model-control-tab-advanced'
                  itemKey='advanced'
                  tab={t('高级')}
                >
                  <div className='model-control-section px-6 py-5'>
                    <Form.Input
                      className='model-control-icon'
                      field='icon'
                      label={t('模型图标')}
                      placeholder={t('例如 OpenAI 或 Claude.Color')}
                      extraText={
                        <Typography.Text
                          className='model-control-icon-doc'
                          link={{
                            href: 'https://icons.lobehub.com/components/lobe-hub',
                            target: '_blank',
                          }}
                          icon={
                            <IconLink className='model-control-icon-link' />
                          }
                        >
                          {t('查看图标目录')}
                        </Typography.Text>
                      }
                      showClear
                    />
                    <div className='model-control-effective-endpoints mb-4'>
                      <Text className='model-control-effective-endpoints-label block text-sm font-medium mb-2'>
                        {t('当前有效端点')}
                      </Text>
                      <Space
                        className='model-control-effective-endpoints-list'
                        wrap
                      >
                        {(loadedModel?.effective_endpoints || []).length > 0 ? (
                          loadedModel.effective_endpoints.map((endpoint) => (
                            <Tag
                              className='model-control-effective-endpoint'
                              color='blue'
                              key={endpoint}
                            >
                              {endpoint}
                            </Tag>
                          ))
                        ) : (
                          <Text className='model-control-effective-endpoints-empty text-xs !text-semi-color-text-2'>
                            {t('当前没有可发布端点')}
                          </Text>
                        )}
                      </Space>
                    </div>
                    <JSONEditor
                      className='model-control-endpoint-editor'
                      field='endpoints'
                      label={t('端点显式覆盖')}
                      placeholder={JSON.stringify(ENDPOINT_TEMPLATE, null, 2)}
                      value={values.endpoints}
                      onChange={(value) =>
                        formApiRef.current?.setValue('endpoints', value)
                      }
                      formApi={formApiRef.current}
                      editorType='object'
                      template={ENDPOINT_TEMPLATE}
                      templateLabel={t('填入端点模板')}
                      extraText={t(
                        '通常无需填写：运行时端点由渠道协议目录生成。仅在模型需要缩小或改写公开端点时使用。',
                      )}
                      extraFooter={
                        endpointGroups.length > 0 ? (
                          <Space
                            className='model-control-endpoint-presets'
                            wrap
                          >
                            {endpointGroups.map((group) => (
                              <Button
                                className='model-control-endpoint-preset'
                                key={group.id}
                                size='small'
                                theme='borderless'
                                onClick={() => applyEndpointGroup(group)}
                              >
                                {group.name}
                              </Button>
                            ))}
                          </Space>
                        ) : null
                      }
                    />
                  </div>
                </Tabs.TabPane>
              </Tabs>
            </div>
          )}
        </Form>
      </Spin>
    </SideSheet>
  );
};

export default EditModelModal;
