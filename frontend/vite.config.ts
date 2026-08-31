import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: false,
  },
};

export default defineConfig({
  server: {
    proxy: apiProxy,
  },

  preview: {
    proxy: apiProxy,
  },

  build: {
    outDir: '/var/www/ackinackiradar.com',
    emptyOutDir: true,
    sourcemap: false,
  },
});
