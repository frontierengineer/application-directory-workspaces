import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  Failure,
  PoolSlot,
  ProvisionerListSlotsInput,
  ProvisionerMeasureInput,
  ProvisionerMountInput,
  ProvisionerRemoveInput,
  ProvisionerSlotCheckInput,
  ProvisionerUnmountInput,
  Slot,
  SlotCheckResult,
  Unavailable,
  WorkspaceMeasure,
  WorkspaceProvisionerContext,
  WorkspaceProvisionerImplementation,
  WorkspaceProvisionerInstance,
} from '../../application';
import { failure, text } from './text.ts';

interface Settings {
  directory: string;
  template: string;
}

type Answer<T> = T | Failure | Unavailable;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function settingsOf(instance: WorkspaceProvisionerInstance): Settings | null {
  const value = (key: string) => {
    const raw = instance.configuration[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  if (value('directory') === '') return null;
  return {
    directory: resolve(expandHome(value('directory'))),
    template: value('template') === '' ? '' : resolve(expandHome(value('template'))),
  };
}

export function directoryName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+|[-]+$/g, '');
  return cleaned.length > 0 ? cleaned : `workspace-${createHash('sha1').update(name).digest('hex').slice(0, 10)}`;
}

function inside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}

// listSlots() and measure() answer within a call's wait, so a directory too
// large to measure in this long is reported with no size.
const measureTimeoutMilliseconds = 10_000;

function sizeBytes(path: string): Promise<number | null> {
  return new Promise((done) => {
    const child = spawn('du', ['-sk', path], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const deadline = setTimeout(() => child.kill('SIGKILL'), measureTimeoutMilliseconds);
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', () => {
      clearTimeout(deadline);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      const kib = Number(out.split('\t')[0]);
      done(code !== null && out.trim() !== '' && Number.isFinite(kib) ? kib * 1024 : null);
    });
  });
}

async function newestChange(path: string, budget = { entries: 20_000 }): Promise<number | null> {
  let newest: number | null = null;
  const queue = [path];
  while (queue.length > 0 && budget.entries > 0) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      budget.entries -= 1;
      const full = join(directory, entry.name);
      try {
        const info = await lstat(full);
        newest = Math.max(newest ?? 0, info.mtimeMs);
      } catch {
        continue;
      }
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') queue.push(full);
    }
  }
  if (newest === null) {
    try {
      newest = (await stat(path)).mtimeMs;
    } catch {
      return null;
    }
  }
  return Math.round(newest);
}

export function createDirectoryProvisioner(context: WorkspaceProvisionerContext): WorkspaceProvisionerImplementation {
  const t = (token: string, values: Record<string, string | number> = {}) => text(context, token, values);
  const cache = new Map<string, { at: number; measure: WorkspaceMeasure }>();

  const settingsOrFailure = (instance: WorkspaceProvisionerInstance): Settings | Failure =>
    settingsOf(instance) ?? failure(t('error.directory_required'), false, 'directory');

  async function ensureRoot(settings: Settings): Promise<Failure | null> {
    if (existsSync(settings.directory) && !(await stat(settings.directory)).isDirectory()) {
      return failure(t('error.not_directory', { directory: settings.directory }), false, 'directory');
    }
    await mkdir(settings.directory, { recursive: true });
    return null;
  }

  async function mount(input: ProvisionerMountInput): Promise<Answer<Slot>> {
    const settings = settingsOrFailure(input.workspaceProvisioner);
    if ('ok' in settings) return settings;
    const path = join(settings.directory, directoryName(input.name));
    try {
      const rootProblem = await ensureRoot(settings);
      if (rootProblem) return rootProblem;
      if (input.activeSlotDirectories.map((active) => resolve(active)).includes(path)) {
        return failure(t('error.already_mounted', { path }), false, 'name');
      }
      if (!existsSync(path)) {
        const base = input.base?.trim() ?? '';
        if (base !== '') {
          const source = join(settings.directory, directoryName(base));
          if (!existsSync(source) || source === path) return failure(t('error.unknown_base', { base, directory: settings.directory }), false, 'base');
          await cp(source, path, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        } else if (settings.template !== '') {
          if (!existsSync(settings.template) || !(await stat(settings.template)).isDirectory()) {
            return failure(t('error.missing_template', { template: settings.template }), false, 'template');
          }
          await cp(settings.template, path, { recursive: true, errorOnExist: true, force: false });
        } else {
          await mkdir(path);
        }
      }
      cache.delete(path);
      return { slotDirectory: path, display: [{ label: t('display.directory'), value: path }] };
    } catch (error) {
      return failure(t('error.mount_failed', { path, reason: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  async function unmount(input: ProvisionerUnmountInput): Promise<Answer<void>> {
    if (input.slot) cache.delete(input.slot.slotDirectory);
  }

  async function remove(input: ProvisionerRemoveInput): Promise<Answer<void>> {
    const settings = settingsOrFailure(input.workspaceProvisioner);
    if ('ok' in settings) return settings;
    const path = join(settings.directory, directoryName(input.name));
    if (!inside(settings.directory, path)) return;
    try {
      await rm(path, { recursive: true, force: true });
      cache.delete(path);
    } catch (error) {
      return failure(t('error.remove_failed', { path, reason: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  async function checkSlot(input: ProvisionerSlotCheckInput): Promise<Answer<SlotCheckResult>> {
    const path = input.slot.slotDirectory;
    if (path === '' || existsSync(path)) return { present: true };
    const settings = settingsOrFailure(input.workspaceProvisioner);
    if ('ok' in settings) return settings;
    try {
      await readdir(settings.directory);
      return { present: false };
    } catch {
      return failure(t('error.check_failed', { directory: settings.directory, path }), true);
    }
  }

  async function measureDirectory(path: string): Promise<WorkspaceMeasure> {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.at < 60_000) return cached.measure;
    const measure = existsSync(path)
      ? { sizeBytes: await sizeBytes(path), lastUsedAt: await newestChange(path) }
      : { sizeBytes: null, lastUsedAt: null };
    cache.set(path, { at: Date.now(), measure });
    return measure;
  }

  async function listSlots(input: ProvisionerListSlotsInput): Promise<Answer<PoolSlot[]>> {
    const settings = settingsOrFailure(input.workspaceProvisioner);
    if ('ok' in settings) return settings;
    if (!existsSync(settings.directory)) return [];
    try {
      const entries = (await readdir(settings.directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      return Promise.all(entries.map(async (name) => {
        const slotDirectory = join(settings.directory, name);
        const measured = await measureDirectory(slotDirectory);
        const slot: PoolSlot = { slotDirectory, display: [{ label: t('display.directory'), value: name }] };
        if (measured.sizeBytes !== null) slot.sizeBytes = measured.sizeBytes;
        return slot;
      }));
    } catch (error) {
      return failure(t('error.list_failed', { directory: settings.directory, reason: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  async function measure(input: ProvisionerMeasureInput): Promise<Answer<WorkspaceMeasure>> {
    const settings = settingsOrFailure(input.workspaceProvisioner);
    if ('ok' in settings) return settings;
    return measureDirectory(input.slot?.slotDirectory || join(settings.directory, directoryName(input.name)));
  }

  return { mount, unmount, remove, checkSlot, listSlots, measure };
}
