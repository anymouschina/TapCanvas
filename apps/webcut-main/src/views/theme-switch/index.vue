<script setup lang="tsx">
import { NIcon, NSwitch } from 'naive-ui';
import { useWebCutDarkMode } from '../../hooks';
import { WeatherMoon16Regular, WeatherSunny16Regular } from '@vicons/fluent';

const { isDarkMode } = useWebCutDarkMode();
</script>

<template>
    <n-switch v-model:value="isDarkMode" size="small" :style="{
        '--n-rail-color-active': '#222',
    }" style="margin-top: -2px;" class="webcut-theme-switch">
        <template #checked-icon>
            <n-icon :component="WeatherMoon16Regular"></n-icon>
        </template>
        <template #unchecked-icon>
            <n-icon :component="WeatherSunny16Regular"></n-icon>
        </template>
    </n-switch>
</template>

<style>
.webcut-root .webcut-theme-switch.n-switch.n-switch--active .n-switch__rail {
    --n-rail-color-active: #444 !important;
}
</style>