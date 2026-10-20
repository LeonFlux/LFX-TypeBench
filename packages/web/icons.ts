import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// `<svg data-icon="24/outline/x-mark" …></svg>` in index.html becomes a `<use>` of one built Heroicons sprite.
const ICON = /<svg([^>]*?)\sdata-icon="([^"]*)"([^>]*)><\/svg>/g;
const NAME = /^(16|20|24)\/(outline|solid)\/[a-z0-9-]+$/;
const STRIPPED = /\s(xmlns|aria-hidden|data-slot)="[^"]*"/g;
const HASH_LENGTH = 8;

const symbolId = (name: string) => name.replaceAll('/', '-');

export function iconNames(html: string): string[] {
  const names = [...new Set([...html.matchAll(ICON)].map((match) => match[2]))].sort();
  const invalid = names.filter((name) => !NAME.test(name));
  if (invalid.length) throw new Error(`Unknown icon name: ${invalid.join(', ')}`);
  return names;
}

export function symbolOf(name: string, svg: string): string {
  return svg
    .replace(STRIPPED, '')
    .replace('<svg', `<symbol id="${symbolId(name)}"`)
    .replace('</svg>', '</symbol>')
    .trim();
}

export function spriteOf(symbols: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
}

export function useIcons(html: string, href: string): string {
  return html.replace(
    ICON,
    (_, before: string, name: string, after: string) =>
      `<svg${before}${after}><use href="${href}#${symbolId(name)}"/></svg>`,
  );
}

export function heroicons(): Plugin {
  const require = createRequire(import.meta.url);
  let base = '/';
  let root = '';
  let fileName = '';
  return {
    name: 'heroicons-sprite',
    configResolved(config) {
      base = config.base;
      root = config.root;
    },
    buildStart() {
      const html = readFileSync(join(root, 'index.html'), 'utf8');
      const symbols = iconNames(html).map((name) =>
        symbolOf(name, readFileSync(require.resolve(`heroicons/${name}.svg`), 'utf8')),
      );
      const source = spriteOf(symbols);
      fileName = `assets/icons-${createHash('sha256').update(source).digest('hex').slice(0, HASH_LENGTH)}.svg`;
      this.emitFile({ type: 'asset', fileName, source });
    },
    transformIndexHtml: (html) => useIcons(html, `${base}${fileName}`),
  };
}
