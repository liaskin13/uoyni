import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.{js,ts}",
      "scripts/**/__tests__/**/*.test.{js,ts}",
    ],
    exclude: ["node_modules", "gstack", "skills"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react-vendor'
          }

          if (id.includes('/three/')) {
            return 'three-core'
          }

          if (id.includes('/@react-three/fiber/')) {
            return 'r3f-core'
          }

          if (id.includes('/@react-three/drei/')) {
            return 'r3f-drei'
          }

          if (
            id.includes('/@react-three/postprocessing/') ||
            id.includes('/postprocessing/')
          ) {
            return 'postfx-vendor'
          }

          if (id.includes('/framer-motion/')) {
            return 'motion-vendor'
          }
        },
      },
    },
  },
})