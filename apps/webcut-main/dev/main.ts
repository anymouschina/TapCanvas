import { createApp } from 'vue'
import App from './App.vue'
import { bootstrapAuthFromUrl } from '../src/libs/auth'

bootstrapAuthFromUrl()

createApp(App).mount('#app')
