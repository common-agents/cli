import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

// Builds the CLI and the library entry point as ES modules for Node.
// Runtime dependencies and Node built-ins stay external.
export default defineConfig({
  define: {
    __CAF_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: { cli: 'src/bin.ts', index: 'src/index.ts' },
      external: [
        ...Object.keys(pkg.dependencies),
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
