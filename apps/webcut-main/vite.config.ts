import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve, dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const allDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
];

// 根据环境变量选择构建配置
// webcomponents | esm | webcomponents_bundle
// 默认为esm
const buildType = process.env.BUILD_TYPE || 'esm';

// 导出配置
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    buildType === 'esm' ? dts({
      insertTypesEntry: true,
      cleanVueFileName: true,
      copyDtsFiles: false,
      include: ['src/**/*'],
      exclude: [
        'src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/*.md',
        'src/webcomponents.ts',
      ],
    }) : undefined,
  ].filter(Boolean),
  define: buildType.endsWith('_bundle') ? {
    'process.env.NODE_ENV': JSON.stringify(mode),
  } : undefined,
  build: {
    lib: {
      entry: buildType.startsWith('webcomponents') ? resolve(__dirname, 'src/webcomponents.ts') : resolve(__dirname, 'src/index.ts'),
      name: 'WebCut',
      fileName: () => 'index.js',
      formats: [buildType.endsWith('_bundle') ? 'iife' : 'es'],
    },
    sourcemap: true,
    minify: buildType.endsWith('_bundle'),
    outDir: {
      webcomponents: 'webcomponents',
      webcomponents_bundle: 'webcomponents/bundle',
      esm: 'esm',
    }[buildType],
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      external: buildType.endsWith('_bundle') ? [] : allDependencies,
    },
  },
}));

