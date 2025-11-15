import NodeProcess from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import { default as VitePluginSolid } from 'vite-plugin-solid'
import { default as VitePluginTailwindCSS } from '@tailwindcss/vite'
import { default as VitePluginTSConfigPaths } from 'vite-tsconfig-paths'
import { cloudflare as VitePluginCloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart as VitePluginTanstackStart } from '@tanstack/solid-start/plugin/vite'

export default defineConfig(config => {
  const env = loadEnv(config.mode, NodeProcess.cwd(), '')

  return {
    plugins: [
      VitePluginTSConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      VitePluginCloudflare({
        viteEnvironment: { name: 'ssr' },
      }),
      VitePluginTailwindCSS(),
      VitePluginTanstackStart({
        start: { entry: './src/start.ts' },
        server: { entry: './src/server.ts' },
        client: { entry: './src/client.ts' },
      }),
      VitePluginSolid({ ssr: true }),
    ],
    server: {
      port: Number(env.PORT || randomIntInclusive(3_100, 8_100)),
    },
    build: {
      target: 'esnext',
    },
  }
})

function randomIntInclusive(min: number, max: number) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min
}
