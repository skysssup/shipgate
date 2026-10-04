import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Writes the license text of every bundled package (code and fonts) to third-party-licenses.txt. */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle(_, bundle) {
      const packages = new Map<string, string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          const match = /^\0?(.*[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+))[\\/]/.exec(id);
          if (match) packages.set(match[2].replace(/\\/g, '/'), match[1]);
        }
      }
      const sections = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license?: string; author?: string | { name: string } };
        const file = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
        const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
        const text = file
          ? readFileSync(join(dir, file), 'utf8').trim()
          : `${pkg.license} license${author ? `, copyright ${author}` : ''}. The package ships no license file.`;
        return `${name}@${pkg.version} (${pkg.license ?? 'see license text'})\n\n${text}`;
      });
      if (!sections.length) throw new Error('third-party-licenses: no bundled packages found');
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source: `Third-party software in the Shipgate simulator\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), thirdPartyLicenses()],
  // Relative asset URLs, so the same build works from any path: `shipgate demo --serve`,
  // a static file server, or a subdirectory.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The editor (CodeMirror) has no React dependency, so it can load as its own chunk.
    rollupOptions: {
      output: {
        manualChunks: (id) => (/[\\/]node_modules[\\/](@codemirror|@lezer|crelt|style-mod|w3c-keyname)[\\/]/.test(id) ? 'editor' : undefined),
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
