import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Actions では公開するコミットの番号、手元では dev
const version = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);
const builtAt = new Date().toISOString();

// GitHub Pages ではリポジトリ名のサブパスで配信されるため、相対パスで出力する
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  plugins: [
    react(),
    {
      // 開いている画面が古くなったかを確かめるためのファイル
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, builtAt }) });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1500 },
});
