/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import React from 'react';
import { IconCopy } from '@douyinfe/semi-icons';

const DocsToolbar = ({ modelCount, specCount, disabled, onCopyAll }) => (
  <div className='tc-api-docs__toolbar'>
    <div className='tc-api-docs__toolbar-shell'>
      <div className='tc-api-docs__toolbar-summary'>
        <span className='tc-api-docs__live-dot' aria-hidden='true' />
        <span className='tc-api-docs__toolbar-text'>
          实时文档 · {modelCount} 个模型 · {specCount} 个规格
        </span>
      </div>
      <button
        className='tc-api-docs__copy-all'
        type='button'
        disabled={disabled}
        onClick={onCopyAll}
      >
        <IconCopy className='tc-api-docs__button-icon' aria-hidden='true' />
        <span className='tc-api-docs__button-label'>复制全部文档</span>
      </button>
    </div>
  </div>
);

export default DocsToolbar;
