import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/diff/' : '/',
  plugins: [
    vue(),
    vuetify({
      styles: {
        configFile: 'src/assets/vuetify/settings.scss',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    minify: false,
    cssMinify: false,
    rollupOptions: {
      output: {
        // Fonts are immutable per package version, so skip the content
        // hash to avoid noisy diffs on the deployment site.
        assetFileNames(assetInfo) {
          const name = assetInfo.name ?? ''
          if (/\.(woff2?|ttf|eot|otf)$/i.test(name)) {
            return 'assets/[name][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        },
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Order matters: check vuetify before vue, since vuetify
            // imports vue internally and we don't want those files
            // sorted into the vue chunk.
            if (id.includes('vuetify')) return 'vendor-vuetify'
            if (id.includes('vue')) return 'vendor-vue'
            return 'vendor'
          }
        },
      },
    },
  },
}))
