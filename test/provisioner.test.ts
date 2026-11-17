import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Failure, PoolSlot, Slot, WorkspaceMeasure, WorkspaceProvisionerImplementation } from '../../application';
import { registration } from '../worker.ts';
import { directoryName } from '../src/provisioner.ts';
import { fakeContext, instance } from './context.ts';

function setup(): { impl: WorkspaceProvisionerImplementation; base: string; root: string } {
  const { context, base } = fakeContext();
  const impl = registration.workspaceProvisioner.mount(context) as WorkspaceProvisionerImplementation;
  return { impl, base, root: join(base, 'workspaces') };
}

function slotOf(answer: unknown): Slot {
  assert.ok(answer && typeof answer === 'object' && 'slotDirectory' in answer, `expected a slot, got ${JSON.stringify(answer)}`);
  return answer as Slot;
}

function failureOf(answer: unknown): Failure {
  assert.ok(answer && typeof answer === 'object' && 'ok' in answer && answer.ok === false, `expected a failure, got ${JSON.stringify(answer)}`);
  return answer as Failure;
}

const mountInput = (configuration: Record<string, string>, name: string, extra: { base?: string; active?: string[] } = {}) => ({
  workspaceId: `ws-${name}`,
  workspaceProvisioner: instance(configuration),
  name,
  activeSlotDirectories: extra.active ?? [],
  base: extra.base ?? null,
});

test('mount makes a directory for a new name and gives the same one back for that name later', async () => {
  const { impl, root } = setup();
  const slot = slotOf(await impl.mount(mountInput({ directory: root }, 'notes')));
  assert.equal(slot.slotDirectory, join(root, 'notes'));
  assert.deepEqual(slot.display, [{ label: 'Directory', value: join(root, 'notes') }]);
  writeFileSync(join(slot.slotDirectory, 'draft.md'), 'hello');
  assert.equal(await impl.unmount({ workspaceId: 'ws-notes', workspaceProvisioner: instance({ directory: root }), slot }), undefined);
  assert.equal(readFileSync(join(root, 'notes', 'draft.md'), 'utf8'), 'hello');
  const again = slotOf(await impl.mount(mountInput({ directory: root }, 'notes')));
  assert.equal(readFileSync(join(again.slotDirectory, 'draft.md'), 'utf8'), 'hello');
});

test('a new workspace starts as a copy of the template, or of the workspace its base names', async () => {
  const { impl, base, root } = setup();
  const template = join(base, 'template');
  mkdirSync(join(template, 'src'), { recursive: true });
  writeFileSync(join(template, 'src', 'index.js'), 'template');
  const fromTemplate = slotOf(await impl.mount(mountInput({ directory: root, template }, 'one')));
  assert.equal(readFileSync(join(fromTemplate.slotDirectory, 'src', 'index.js'), 'utf8'), 'template');
  writeFileSync(join(fromTemplate.slotDirectory, 'src', 'index.js'), 'changed in one');
  const fromBase = slotOf(await impl.mount(mountInput({ directory: root, template }, 'two', { base: 'one' })));
  assert.equal(readFileSync(join(fromBase.slotDirectory, 'src', 'index.js'), 'utf8'), 'changed in one');
  const unknownBase = failureOf(await impl.mount(mountInput({ directory: root }, 'three', { base: 'nope' })));
  assert.equal(unknownBase.field, 'base');
  assert.equal(unknownBase.retriable, false);
  const missingTemplate = failureOf(await impl.mount(mountInput({ directory: root, template: join(base, 'missing') }, 'four')));
  assert.equal(missingTemplate.field, 'template');
  assert.equal(existsSync(join(root, 'four')), false);
});

test('mount refuses a directory another mounted workspace holds, a file as the directory, and no directory at all', async () => {
  const { impl, base, root } = setup();
  const slot = slotOf(await impl.mount(mountInput({ directory: root }, 'busy')));
  assert.equal(failureOf(await impl.mount(mountInput({ directory: root }, 'busy', { active: [slot.slotDirectory] }))).field, 'name');
  writeFileSync(join(base, 'file'), 'x');
  assert.match(failureOf(await impl.mount(mountInput({ directory: join(base, 'file') }, 'x'))).message, /is a file, not a directory/);
  assert.equal(failureOf(await impl.mount(mountInput({}, 'x'))).field, 'directory');
  const home = slotOf(await impl.mount(mountInput({ directory: '~/.frontier-directory-workspaces-test' }, 'tilde')));
  assert.ok(!home.slotDirectory.includes('~'));
  rmSync(join(home.slotDirectory, '..'), { recursive: true, force: true });
});

test('remove deletes the workspace directory and nothing else', async () => {
  const { impl, root } = setup();
  const keep = slotOf(await impl.mount(mountInput({ directory: root }, 'keep')));
  const gone = slotOf(await impl.mount(mountInput({ directory: root }, 'gone')));
  writeFileSync(join(gone.slotDirectory, 'f'), 'x');
  assert.equal(await impl.remove!({ workspaceId: 'ws-gone', workspaceProvisioner: instance({ directory: root }), name: 'gone' }), undefined);
  assert.equal(existsSync(gone.slotDirectory), false);
  assert.equal(existsSync(keep.slotDirectory), true);
  assert.equal(await impl.remove!({ workspaceId: 'ws-gone', workspaceProvisioner: instance({ directory: root }), name: 'gone' }), undefined);
});

test('checkSlot says gone only when the directory that holds it can be read', async () => {
  const { impl, root } = setup();
  const slot = slotOf(await impl.mount(mountInput({ directory: root }, 'check')));
  const check = (directory: string) => impl.checkSlot!({ workspaceId: 'w', workspaceProvisioner: instance({ directory }), name: 'check', slot });
  assert.deepEqual(await check(root), { present: true });
  rmSync(slot.slotDirectory, { recursive: true });
  assert.deepEqual(await check(root), { present: false });
  rmSync(root, { recursive: true });
  assert.equal(failureOf(await check(root)).retriable, true);
});

test('listSlots and measure report each workspace directory with its size and last change', async () => {
  const { impl, root } = setup();
  const a = slotOf(await impl.mount(mountInput({ directory: root }, 'a')));
  slotOf(await impl.mount(mountInput({ directory: root }, 'b')));
  writeFileSync(join(a.slotDirectory, 'data.bin'), Buffer.alloc(10_000));
  const slots = (await impl.listSlots!({ workspaceProvisioner: instance({ directory: root }) })) as PoolSlot[];
  assert.deepEqual(slots.map((slot) => slot.display[0]?.value), ['a', 'b']);
  assert.ok((slots[0]?.sizeBytes ?? 0) >= 10_000);
  const measured = (await impl.measure!({ workspaceId: 'w', workspaceProvisioner: instance({ directory: root }), name: 'a', slot: null })) as WorkspaceMeasure;
  assert.ok((measured.sizeBytes ?? 0) >= 10_000);
  assert.ok((measured.lastUsedAt ?? 0) > Date.now() - 60_000);
  assert.deepEqual(await impl.measure!({ workspaceId: 'w', workspaceProvisioner: instance({ directory: root }), name: 'never', slot: null }), { sizeBytes: null, lastUsedAt: null });
  assert.deepEqual(await impl.listSlots!({ workspaceProvisioner: instance({ directory: join(root, 'missing') }) }), []);
});

test('a name becomes one safe directory name', () => {
  assert.equal(directoryName('Fix login bug'), 'Fix-login-bug');
  assert.equal(directoryName('../escape'), 'escape');
  assert.match(directoryName('..'), /^workspace-[0-9a-f]{10}$/);
  assert.equal(directoryName('a/b'), 'a-b');
});
