import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { newsPlugin } from './server/newsPlugin.js';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  if (process.env.SILICON_E2E !== '1' && !process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  return {
    root: projectRoot,
    plugins: [newsPlugin(), react()],
    // maplibre-gl v6 的 worker 是独立 mjs 文件，预打包会丢失 worker chunk（ERR_FAILED）→ 排除预打包
    optimizeDeps: { exclude: ['maplibre-gl'] },
    server: {
      port: 5175,
      allowedHosts: ['.monkeycode-ai.online', 'localhost', '127.0.0.1'],
      proxy: {
        '/api/scrape': {
          target: 'http://localhost:5000',
          changeOrigin: true
        }
      }
    }
  };
});
