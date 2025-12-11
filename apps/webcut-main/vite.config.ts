import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve, dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const resolvePath = (...paths: string[]) => resolve(__dirname, ...paths);
const preferExisting = (primary: string, fallback: string) => fs.existsSync(primary) ? primary : fallback;
const allDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
];
const fallbackStyle = resolvePath('dev/style-fallback.css');
const localAliases = {
  'webcut/webcomponents/style.css': preferExisting(resolvePath('webcomponents/style.css'), fallbackStyle),
  'webcut/esm/style.css': preferExisting(resolvePath('esm/style.css'), fallbackStyle),
  'webcut/webcomponents': preferExisting(resolvePath('webcomponents/index.js'), resolvePath('src/webcomponents.ts')),
  'webcut/esm': preferExisting(resolvePath('esm/index.js'), resolvePath('src/index.ts')),
  webcut: preferExisting(resolvePath('esm/index.js'), resolvePath('src')),
};

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
  resolve: {
    alias: localAliases,
  },
  // 让 Vite 从当前包目录读取 .env（非仓库根）
  envDir: __dirname,
  server: {
    host: true,
    port: 5174,
  },
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
