import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceProvisionerContext, WorkspaceProvisionerInstance } from '../../application';

const translations = JSON.parse(readFileSync(new URL('../translations.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>;

export function fakeContext(): { context: WorkspaceProvisionerContext; base: string } {
  const base = mkdtempSync(join(tmpdir(), 'directory-workspaces-test-'));
  mkdirSync(join(base, 'private'));
  mkdirSync(join(base, 'scratch'));
  const quiet = async () => undefined;
  const context = {
    applicationId: 'github.com/frontierengineer/application-directory-workspaces',
    directories: { private: join(base, 'private'), scratch: join(base, 'scratch') },
    translate: (token: string) => translations.en?.[token] ?? token,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
  } as unknown as WorkspaceProvisionerContext;
  return { context, base };
}

export function instance(configuration: Record<string, string>): WorkspaceProvisionerInstance {
  return { id: 'instance-1', configuration };
}
