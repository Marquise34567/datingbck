import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Determine a sensible backend default by reading backend/src/index.ts if present.
function detectBackendPort(): number {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const backendIndex = path.resolve(__dirname, '../backend/src/index.ts');
    const txt = fs.readFileSync(backendIndex, 'utf8');
    const m = txt.match(/process\.env\.PORT\s*\|\|\s*(\d+)/);
    if (m) return Number(m[1]);
  } catch (e) {
    // ignore
  }
  return 3001;
}

export default defineConfig(() => {
  const detectedPort = detectBackendPort();
  // Priority: VITE_PROXY_TARGET, then other envs, otherwise inferred port
  const backend = process.env.VITE_PROXY_TARGET || process.env.VITE_BACKEND_URL || process.env.BACKEND_URL || `http://localhost:${detectedPort}`;

  return {
    plugins: [react()],
    define: {
      "process.env": {},
    },
    server: {
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          secure: false,
          // remove or rewrite cookie Domain attributes so browser will accept cookies
          cookieDomainRewrite: "",
        },
      },
    },
  };
});
