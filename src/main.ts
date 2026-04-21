import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createVuetify } from 'vuetify'
import '@mdi/font/css/materialdesignicons.css'
import './assets/vuetify/main.scss'
import './assets/variables.scss'
import App from './App.vue'
import HtmlDiff from './pages/htmldiff.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HtmlDiff },
  ],
})

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#3F81AE',
          secondary: '#79B6E6',
          error: '#ff5252',
        },
      },
    },
  },
  defaults: {
    VTextField: { variant: 'underlined' },
    VTextarea: { variant: 'underlined' },
    VSelect: { variant: 'underlined' },
    VCombobox: { variant: 'underlined' },
    VAutocomplete: { variant: 'underlined' },
  },
})

const app = createApp(App)
app.use(router)
app.use(vuetify)
app.mount('#app')
