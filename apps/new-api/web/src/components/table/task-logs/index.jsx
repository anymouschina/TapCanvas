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
import { Layout } from '@douyinfe/semi-ui';
import CardPro from '../../common/ui/CardPro';
import TaskLogsTable from './TaskLogsTable';
import TaskLogsActions from './TaskLogsActions';
import TaskLogsFilters from './TaskLogsFilters';
import ColumnSelectorModal from './modals/ColumnSelectorModal';
import ContentModal from './modals/ContentModal';
import AudioPreviewModal from './modals/AudioPreviewModal';
import InputPreviewModal from './modals/InputPreviewModal';
import RequestTraceModal from '../usage-logs/modals/RequestTraceModal';
import { useTaskLogsData } from '../../../hooks/task-logs/useTaskLogsData';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import { createCardProPagination } from '../../../helpers/utils';

const TaskLogsPage = () => {
  const taskLogsData = useTaskLogsData();
  const isMobile = useIsMobile();

  return (
    <>
      {/* Modals */}
      <ColumnSelectorModal {...taskLogsData} />
      <ContentModal {...taskLogsData} isVideo={false} />
      {/* 新增：视频预览弹窗 */}
      <ContentModal
        isModalOpen={taskLogsData.isVideoModalOpen}
        setIsModalOpen={taskLogsData.setIsVideoModalOpen}
        modalContent={taskLogsData.videoUrl}
        isVideo={true}
      />
      <AudioPreviewModal
        isModalOpen={taskLogsData.isAudioModalOpen}
        setIsModalOpen={taskLogsData.setIsAudioModalOpen}
        audioClips={taskLogsData.audioClips}
      />
      {/* 新增：入参预览弹窗（参考图 + 提示词） */}
      <InputPreviewModal
        isModalOpen={taskLogsData.isInputModalOpen}
        setIsModalOpen={taskLogsData.setIsInputModalOpen}
        inputData={taskLogsData.inputModalData}
      />
      {/* 新增：请求链路弹窗（复用普通日志组件，原始请求体里参考图为真实 https 可预览） */}
      <RequestTraceModal {...taskLogsData} />

      <Layout>
        <CardPro
          type='type2'
          statsArea={<TaskLogsActions {...taskLogsData} />}
          searchArea={<TaskLogsFilters {...taskLogsData} />}
          paginationArea={createCardProPagination({
            currentPage: taskLogsData.activePage,
            pageSize: taskLogsData.pageSize,
            total: taskLogsData.logCount,
            onPageChange: taskLogsData.handlePageChange,
            onPageSizeChange: taskLogsData.handlePageSizeChange,
            isMobile: isMobile,
            t: taskLogsData.t,
          })}
          t={taskLogsData.t}
        >
          <TaskLogsTable {...taskLogsData} />
        </CardPro>
      </Layout>
    </>
  );
};

export default TaskLogsPage;
