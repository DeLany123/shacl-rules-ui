import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/app.js'),
      name: 'ShaclApp',
      fileName: () => 'app.bundle.js',
      formats: ['es'],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.browser': true,
  },
  resolve: {
    alias: {
      'vue': 'vue/dist/vue.esm-bundler.js',
      'node:diagnostics_channel': path.resolve(__dirname, 'src/stubs/diagnostics_channel.js'),
      'diagnostics_channel':      path.resolve(__dirname, 'src/stubs/diagnostics_channel.js'),
    },
  },
});

