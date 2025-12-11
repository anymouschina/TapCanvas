<script setup lang="ts">
import { ref, computed } from 'vue';
import { fixNum } from 'ts-fns';

const props = defineProps<{
  // 单位，默认为deg
  unit?: 'rad' | 'deg';
  borderColor?: string;
}>();
const value = defineModel<number>('value', {
  // 从外部获取弧度值，转换为角度值供内部使用
  get(value: number) {
    if (props.unit === 'rad') {
      return +(value * 180 / Math.PI).toFixed(2) || 0;
    }
    return value;
  },
  // 将内部计算的角度值，转换为弧度值传给外部
  set(angle: number) {
    if (props.unit === 'rad') {
      return +(angle * Math.PI / 180).toFixed(2);
    }
    return angle;
  },
});


const circleRef = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);

const circumference = 60;
const knobRadius = 5;
const padding = knobRadius + 1.5; // Padding to ensure the knob is fully visible
const containerSize = circumference + padding * 2;
const knobCenter = circumference / 2 + padding; // SVG center offset by padding

const startDrag = (event: MouseEvent | TouchEvent) => {
  event.preventDefault(); // Prevent default browser behavior
  isDragging.value = true;
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', endDrag);
  if (event.type === 'touchstart') {
    // @ts-ignore
    document.addEventListener('touchmove', drag);
    document.addEventListener('touchend', endDrag);
  }
};

const drag = (event: MouseEvent | Touch) => {
  if (!isDragging.value || !circleRef.value) return;

  const rect = circleRef.value.getBoundingClientRect();
  // @ts-ignore
  const clientX = 'clientX' in event ? event.clientX : event.touches[0].clientX;
  // @ts-ignore
  const clientY = 'clientY' in event ? event.clientY : event.touches[0].clientY;

  const dx = clientX - (rect.left + knobCenter);
  const dy = clientY - (rect.top + knobCenter);

  // 计算弧度，atan2返回的范围是-PI到PI
  let angleRad = Math.atan2(dy, dx);

  // 将弧度转换为0-360度的顺时针角度值
  let newAngle = (angleRad * 180 / Math.PI) + 90;
  if (newAngle < 0) {
    newAngle += 360;
  }

  value.value = newAngle;
};

const endDrag = () => {
  isDragging.value = false;
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', endDrag);
  // @ts-ignore
  document.removeEventListener('touchmove', drag);
  document.removeEventListener('touchend', endDrag);
};

const knobPosition = computed(() => {
  // 将0-360度的值转换回Math.atan2所需的弧度
  // @ts-ignore
  const angleRad = (value.value - 90) * Math.PI / 180;
  const x = knobCenter + circumference / 2 * Math.cos(angleRad);
  const y = knobCenter + circumference / 2 * Math.sin(angleRad);
  return { x, y };
});

const indicatorPath = computed(() => {
  const startX = knobCenter;
  const startY = knobCenter;
  const endX = knobPosition.value.x;
  const endY = knobPosition.value.y;
  return `M${startX},${startY} L${endX},${endY}`;
});
</script>

<template>
  <div class="webcut-angle-picker" ref="circleRef" :style="{ '--ratote-border-color': borderColor || 'var(--border-color)' }">
    <svg :width="containerSize" :height="containerSize" :viewBox="`0 0 ${containerSize} ${containerSize}`">
      <defs>
        <filter id="shadow">
          <feDropShadow dx="0.5" dy="0.5" stdDeviation="1" flood-color="var(--shadow-color)" flood-opacity="0.2"/>
        </filter>
      </defs>
      <circle
        :cx="knobCenter"
        :cy="knobCenter"
        :r="circumference / 2"
        fill="transparent"
        stroke="var(--circle-stroke-color)"
        stroke-width="1.5"
      />

      <path
        :d="indicatorPath"
        stroke="var(--indicator-color)"
        stroke-width="1.5"
      />

      <circle
        :cx="knobPosition.x"
        :cy="knobPosition.y"
        :r="knobRadius"
        fill="var(--knob-fill-color)"
        stroke="var(--knob-stroke-color)"
        stroke-width="1.5"
        filter="url(#shadow)"
        class="webcut-knob"
        @mousedown.stop="startDrag"
        @touchstart.stop="startDrag"
      />
    </svg>
    <div class="webcut-angle-value">{{ value ? fixNum(value, 2, true) : 0 }}°</div>
  </div>
</template>

<style scoped>
.webcut-angle-picker {
    --circle-stroke-color: var(--border-color);
    --indicator-color: var(--theme-color);
    --knob-fill-color: var(--primary-color-pressed);
    --knob-stroke-color: var(--webcut-grey-color);
    --text-color: var(--text-color);
    --grab-cursor: grab;
    --grabbing-cursor: grabbing;
    --shadow-color:  var(--text-color-3);
    --knob-size: 10px;
    --container-base-size: 60px;

    position: relative;
    width: calc(var(--container-base-size) + var(--knob-size) + 3);
    height: calc(var(--container-base-size) + var(--knob-size) + 3);
    display: flex;
    justify-content: center;
    align-items: center;
    user-select: none;
    touch-action: none;
    cursor: default;
}

.webcut-knob {
  cursor: var(--grab-cursor);
  transition: transform 0.1s ease;
}

.webcut-knob:active {
  cursor: var(--grabbing-cursor);
}

.webcut-angle-value {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 10px;
  font-weight: bold;
  color: var(--text-color);
}
</style>