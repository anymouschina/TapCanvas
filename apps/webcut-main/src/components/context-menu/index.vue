<script setup lang="ts">
import { NDropdown, type DropdownOption } from 'naive-ui';
import { ref } from 'vue';

const emit = defineEmits(['select']);
const props = defineProps<{
    options: DropdownOption[];
    scale?: number;
    disabled?: boolean;
    autoHide?: boolean;
}>();

const dropdownState = ref({
    placement: 'bottom-start' as any,
    x: 0,
    y: 0,
    show: false,
    target: null as any as HTMLElement,
});

async function showContextMenus(event: MouseEvent) {
    event.preventDefault();

    if (props.disabled) {
        return;
    }

    const { clientX, clientY, pageY } = event;
    const pageHeight = document.documentElement.clientHeight;
    const menuListHeight = props.options.length * 40 + 10;
    const placement = pageY > pageHeight - menuListHeight ? 'top-start' : 'bottom-start';
    if (dropdownState.value.show) {
        dropdownState.value.x = clientX;
        dropdownState.value.y = clientY;
        dropdownState.value.placement = placement;
        dropdownState.value.target = event.target as HTMLElement;
    }
    else {
        dropdownState.value = {
            x: clientX,
            y: clientY,
            show: true,
            target: event.target as HTMLElement,
            placement,
        };
    }
}

function hideContextMenus() {
    dropdownState.value.show = false;
    setTimeout(() => {
        dropdownState.value = {
            placement: 'bottom-start',
            x: 0,
            y: 0,
            show: false,
            target: null as any as HTMLElement,
        };
    }, 200);
}

function handleClickContextMenu(value: string) {
    emit('select', value, hideContextMenus);
    if (props.autoHide) {
        hideContextMenus();
    }
}

function handleClickOutsideContextMenu(event: MouseEvent) {
    // 当已经展开，再次右键点击时，避免触发outside事件
    if (event.button === 2 && dropdownState.value.show && event.target === dropdownState.value.target) {
        return;
    }
    hideContextMenus();
}
</script>

<template>
    <slot :hideContextMenus="hideContextMenus" :showContextMenus="showContextMenus"></slot>
    <n-dropdown
        trigger="manual"
        size="small"
        :options="props.options"
        :placement="dropdownState.placement"
        :x="dropdownState.x"
        :y="dropdownState.y"
        :show="dropdownState.show"
        display-directive="if"
        to="body"
        :z-index="1000"
        @clickoutside="handleClickOutsideContextMenu"
        @select="handleClickContextMenu"
    ></n-dropdown>
</template>
