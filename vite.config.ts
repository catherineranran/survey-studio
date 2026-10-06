/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Browsers keep public/config.js for up to 10 minutes (GitHub Pages' cache
// header). A per-build version on its URL makes each deploy load its own copy.
function versionConfigScript(): Plugin {
  const version = Date.now().toString(36);
  return {
    name: 'version-config-script',
    transformIndexHtml: (html) => html.replace('src="./config.js"', `src="./config.js?v=${version}"`),
  };
}

// `base: './'` keeps every asset path relative, so the build works on
// GitHub Pages (https://<user>.github.io/<repo>/), under a custom domain
// (https://ranranli.net/survey-studio/) or on any other static host.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), versionConfigScript(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { environment: 'node' },
}));
