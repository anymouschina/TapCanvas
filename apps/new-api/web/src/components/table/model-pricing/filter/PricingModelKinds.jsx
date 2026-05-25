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

import React from 'react';
import SelectableButtonGroup from '../../../common/ui/SelectableButtonGroup';
import { getModelKind } from '../../../../helpers/modelKind';

const PricingModelKinds = ({
  filterModelKind,
  setFilterModelKind,
  models = [],
  loading = false,
  t,
}) => {
  const kindCount = (kind) =>
    models.filter((m) =>
      kind === 'all' ? true : getModelKind(m) === kind,
    ).length;

  const items = [
    { value: 'all', label: t('全部'), tagCount: kindCount('all') },
    { value: 'chat', label: t('聊天'), tagCount: kindCount('chat') },
    { value: 'image', label: t('图片'), tagCount: kindCount('image') },
    { value: 'video', label: t('视频'), tagCount: kindCount('video') },
  ];

  return (
    <SelectableButtonGroup
      title={t('模型类型')}
      items={items}
      activeValue={filterModelKind}
      onChange={setFilterModelKind}
      loading={loading}
      t={t}
    />
  );
};

export default PricingModelKinds;
