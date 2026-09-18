import { spawn } from 'node:child_process';
import { createServer } from 'vite';

process.env.SILICON_E2E = '1';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.SCRAPLING_URL = '';

// 沙盒里固定端口可能落入 Windows 排除段（EACCES），允许 E2E_PORT 换端口；默认保持 5176 兼容
const port = Number(process.env.E2E_PORT) || 5176;

const server = await createServer({
  configFile: 'vite.config.js',
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

const args = ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    SILICON_E2E: '1',
    DATABASE_URL: process.env.TEST_DATABASE_URL || '',
    SCRAPLING_URL: '',
  },
});

const exitCode = await new Promise(resolve => {
  child.on('close', code => resolve(code ?? 1));
  child.on('error', () => resolve(1));
});

await server.close();
process.exit(exitCode);
