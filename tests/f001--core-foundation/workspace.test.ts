import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COMMAND_TIMEOUT_MS = 60_000;
const PACKAGES = ['@typed-decisions/core', '@typed-decisions/web', '@typed-decisions/server'];

function pnpm(args: string[]) {
  return spawnSync('pnpm', args, { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS });
}

const RESTRICTED_IMPORT_RULE = 'noRestrictedImports';

function lintDiagnostics(directory: string, source: string) {
  const path = join(directory, `probe-${randomUUID()}.ts`);
  writeFileSync(path, source);
  try {
    const { stdout, stderr } = pnpm(['exec', 'biome', 'lint', path]);
    return `${stdout}${stderr}`;
  } finally {
    rmSync(path);
  }
}

describe('Golden', () => {
  it('links core, web, and server as one workspace', () => {
    const listed = JSON.parse(execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { encoding: 'utf8' }));

    expect(listed.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(PACKAGES));
  });

  it('passes the typecheck', { timeout: COMMAND_TIMEOUT_MS }, () => {
    expect(pnpm(['typecheck']).status).toBe(0);
  });

  it('passes the lint', { timeout: COMMAND_TIMEOUT_MS }, () => {
    expect(pnpm(['lint']).status).toBe(0);
  });
});

describe('Edge', () => {
  it.each([
    ['web importing server', 'packages/web/src', '@typed-decisions/server'],
    ['server importing web', 'packages/server/src', '@typed-decisions/web'],
  ])('reports %s as a lint error', { timeout: COMMAND_TIMEOUT_MS }, (_, path, target) => {
    const source = `import { probe } from '${target}';\n\nexport const value = probe;\n`;

    expect(lintDiagnostics(path, source)).toContain(RESTRICTED_IMPORT_RULE);
  });

  it('allows web to import core', { timeout: COMMAND_TIMEOUT_MS }, () => {
    const source = "import { DecisionSchema } from '@typed-decisions/core';\n\nexport const schema = DecisionSchema;\n";

    expect(lintDiagnostics('packages/web/src', source)).not.toContain(RESTRICTED_IMPORT_RULE);
  });
});

describe('Adversarial', () => {
  it('disables dependency lifecycle scripts on install', () => {
    expect(execFileSync('pnpm', ['config', 'get', 'ignore-scripts'], { encoding: 'utf8' }).trim()).toBe('true');
  });
});
