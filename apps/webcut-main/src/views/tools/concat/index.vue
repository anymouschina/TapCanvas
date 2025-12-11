<script setup lang="ts">
import { computed } from 'vue';
import { NPopover, NButton, NIcon } from 'naive-ui';
import { DirectLink } from '@vicons/carbon';
import { useWebCutContext } from '../../../hooks';
import { useT } from '../../../hooks/i18n';
import { downloadOffscreen } from '../../../libs';
import { AudioClip } from '@webav/av-cliper';

const { rails, selected, sources, currentRail, loading } = useWebCutContext();
const t = useT();

// 检查是否可以拼接素材
const canConcat = computed(() => {
  // 必须选中2个素材
  if (selected.value.length !== 2) {
    return false;
  }

  if (!['video', 'audio'].includes(currentRail.value?.type!)) {
    return false;
  }

  // 获取两个选中的segment和对应的rail
  const [selected1, selected2] = selected.value;
  const rail1 = rails.value.find(r => r.id === selected1.railId);
  const rail2 = rails.value.find(r => r.id === selected2.railId);

  // 必须在同一轨道
  if (!rail1 || !rail2 || rail1.id !== rail2.id) {
    return false;
  }

  // 获取segment在轨道中的索引
  const index1 = rail1.segments.findIndex(s => s.id === selected1.segmentId);
  const index2 = rail1.segments.findIndex(s => s.id === selected2.segmentId);

  if (index1 === -1 || index2 === -1) {
    return false;
  }

  // 必须是相邻的素材
  if (Math.abs(index1 - index2) !== 1) {
    return false;
  }

  const segment1 = rail1.segments[index1];
  const segment2 = rail1.segments[index2];

  // 获取素材类型
  const source1 = sources.value.get(segment1.sourceKey);
  const source2 = sources.value.get(segment2.sourceKey);

  if (!source1 || !source2) {
    return false;
  }

  const type1 = source1.type;
  const type2 = source2.type;

  // 必须都是video或audio类型，且类型相同
  if (!['video', 'audio'].includes(type1) || type1 !== type2) {
    return false;
  }

  return true;
});

// 处理拼接素材
async function handleConcat() {
  if (!canConcat.value) {
    return;
  }

  // 获取两个选中的segment和对应的rail

  if (!currentRail.value) {
    return;
  }

  // 获取两个选中的segment和对应的rail
  const [selected1, selected2] = selected.value;

  // 获取segment在轨道中的索引
  const index1 = currentRail.value.segments.findIndex(s => s.id === selected1.segmentId);
  const index2 = currentRail.value.segments.findIndex(s => s.id === selected2.segmentId);

  if (index1 === -1 || index2 === -1) {
    return;
  }

  // 确保segment1在segment2前面
  const segment1 = currentRail.value.segments[index1];
  const segment2 = currentRail.value.segments[index2];
  const [prevSegment, nextSegment] = index1 < index2 ? [segment1, segment2] : [segment2, segment1];

  // 获取对应的素材
  const prevSource = sources.value.get(prevSegment.sourceKey);
  const nextSource = sources.value.get(nextSegment.sourceKey);

  if (!prevSource || !nextSource) {
    return;
  }

  const type = prevSource.type;

  loading.value = true;
  try {
    // 根据素材类型选择导出函数
    if (type === 'video') {
      await downloadOffscreen([prevSource.clip, nextSource.clip], {
        type: 'video/mp4',
        filename: `concatenated-video-${Date.now()}.mp4`
      });
    }
    else if (type === 'audio') {
      await downloadOffscreen([prevSource.clip as AudioClip, nextSource.clip as AudioClip], {
        type: 'audio/mp4',
        filename: `concatenated-audio-${Date.now()}.m4a`
      });
    }
  } catch (error) {
    console.error('拼接素材失败:', error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <n-popover :delay="200" class="webcut-tooltip">
    <template #trigger>
      <n-button quaternary size="small" :focusable="false" @click="handleConcat" class="webcut-tool-button" :disabled="!canConcat">
        <template #icon>
          <n-icon :component="DirectLink" size="16px"></n-icon>
        </template>
      </n-button>
    </template>
    <small>{{ t('将连续且相邻的素材拼接后下载') }}</small>
  </n-popover>
</template>

