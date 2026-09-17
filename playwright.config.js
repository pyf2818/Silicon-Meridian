import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 开屏动画「硅基启动」是全屏 fixed 覆盖层（z-index 10000），会拦截指针事件；
    // 它本就在 prefers-reduced-motion 下不渲染，这里显式宣告 reduce，
    // 免得每条用例都在跟一个纯装饰性覆盖层的挂载/卸载时机赛跑。
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
