<script setup lang="ts">
import { NIcon } from 'naive-ui';
import { Video, Music, Image, StringText, Locked, Unlocked, View, ViewOff, VolumeMute, VolumeUp, Delete } from '@vicons/carbon';
import { useWebCutContext } from '../../../hooks';
import { useWebCutManager } from '../../../hooks/manager';
import { WebCutRail } from '../../../types';

defineProps<{
    rail: WebCutRail
}>();

const { rails, sources, current, canvas, selected } = useWebCutContext();
const { toggleRailHidden, toggleRailMute } = useWebCutManager();

function handleToggleLocked(rail: any) {
    const next = !rail.locked;
    rail.locked = next;

    // 设置rail上所有segment对应的source.sprite.interactable
    for (const segment of rail.segments) {
        const source = sources.value.get(segment.sourceKey);
        if (source && source.sprite) {
            if (next) {
                source.sprite.interactable = 'disabled';
                // 如果当前的segment还是被选中的状态，则取消选中
                if (selected.value.some(item => item.segmentId === segment.id)) {
                    selected.value = selected.value.filter(item => item.segmentId !== segment.id);
                }
                if (current.value === segment.id) {
                    current.value = null;
                    // 使canvas上的选中素材失活
                    canvas.value!.activeSprite = null;
                }
            } else {
                source.sprite.interactable = 'interactive';
            }
        }
    }
}

function handleDeleteRail(railId: string) {
    const railIndex = rails.value.findIndex(r => r.id === railId);
    if (railIndex > -1) {
        rails.value.splice(railIndex, 1);
    }
}
</script>

<template>
    <div class="webcut-manager-webcut-manager-rail-left-side">
        <span class="webcut-manager-webcut-manager-rail-left-side-type-icon" :class="{'webcut-manager-webcut-manager-rail-left-side-main-icon': rail.main }">
            <n-icon :component="Video" v-if="rail.type === 'video'"></n-icon>
            <n-icon :component="Music" v-if="rail.type === 'audio'"></n-icon>
            <n-icon :component="Image" v-if="rail.type === 'image'"></n-icon>
            <n-icon :component="StringText" v-if="rail.type === 'text'"></n-icon>
        </span>
        <span class="webcut-manager-webcut-manager-rail-left-side-action-icon">
            <n-icon :component="Unlocked" @click="handleToggleLocked(rail)" v-if="!rail.locked"></n-icon>
            <n-icon :component="Locked" @click="handleToggleLocked(rail)" v-if="rail.locked"></n-icon>
        </span>
        <span class="webcut-manager-webcut-manager-rail-left-side-action-icon">
            <n-icon :component="View" @click="toggleRailHidden(rail)" v-if="!rail.hidden && !['audio'].includes(rail.type)"></n-icon>
            <n-icon :component="ViewOff" @click="toggleRailHidden(rail)" v-if="rail.hidden && !['audio'].includes(rail.type)"></n-icon>
        </span>
        <span class="webcut-manager-webcut-manager-rail-left-side-action-icon">
            <n-icon :component="VolumeUp" @click="toggleRailMute(rail)" v-if="!rail.mute && ['video'].includes(rail.type)"></n-icon>
            <n-icon :component="VolumeMute" @click="toggleRailMute(rail)" v-if="rail.mute && ['video'].includes(rail.type)"></n-icon>
            <n-icon :component="VolumeUp" @click="toggleRailHidden(rail)" v-if="!rail.hidden && ['audio'].includes(rail.type)"></n-icon>
            <n-icon :component="VolumeMute" @click="toggleRailHidden(rail)" v-if="rail.hidden && ['audio'].includes(rail.type)"></n-icon>
        </span>
        <span class="webcut-manager-webcut-manager-rail-left-side-action-icon" :class="{ 'webcut-manager-webcut-manager-rail-left-side-action-icon--disabled': rail.segments.length > 0 }">
            <n-icon :component="Delete" @click="rail.segments.length === 0 &&handleDeleteRail(rail.id)"></n-icon>
        </span>
    </div>
</template>

<style scoped>
.webcut-manager-webcut-manager-rail-left-side {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: -8px;

    span {
        width: 1em;
        height: 1em;
    }
}
.webcut-manager-webcut-manager-rail-left-side-type-icon {
    opacity: .2;
}
.webcut-manager-webcut-manager-rail-left-side-main-icon {
    color: var(--primary-color);
}
.webcut-manager-webcut-manager-rail-left-side-action-icon {
    transition: color .2s;
}
.webcut-manager-webcut-manager-rail-left-side-action-icon:hover {
    color: var(--primary-color);
}
.webcut-manager-webcut-manager-rail-left-side-action-icon--disabled {
    opacity: .1;
}
</style>