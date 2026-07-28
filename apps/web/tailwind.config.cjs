/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/libtvHome/**/*.{ts,tsx}'],
  important: '.libtv-home',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
}
