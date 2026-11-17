# Directories

A Frontier Workspace Provisioner that gives each workspace a plain directory of
its own on a worker. It is one of Frontier's Initial Applications, written
against Frontier's Application Interface (`interfaces/application.d.ts`) like
any other Application.

## What it does

A person sets the provisioner up once for each place on each worker: a
directory that holds one directory per workspace, and a number of slots, which
is how many workspaces can be mounted there at once.

- **Mount** gives the workspace the directory named from its name. A new name
  starts empty, as a copy of the configured template, or as a copy of the
  workspace its base names. An existing name gets its directory back as it was.
- **Unmount** keeps the directory exactly as it is. Nothing is copied or reset.
- **Remove** deletes the workspace's directory.
- **Check slot** says a directory is gone only when the directory that holds it
  can be read. When it cannot tell, it answers a failure.
- **List slots** and **measure** report each workspace directory with its size
  and the time of its last change.

There is no pool, so there is nothing to provision or tear down, and removing
the provisioner leaves every workspace directory in place.

## Configuration

| Field | Meaning |
| --- | --- |
| Directory | Where the workspace directories live, absolute or starting with `~/`. Default `~/Frontier workspaces`. |
| Template | A directory every new workspace starts as a copy of. Optional. |

## Layout

| Path | What |
| --- | --- |
| `contributions.json` | The Application as data: its provisioner, configuration fields and slots. |
| `worker.ts` | The worker bundle's registration. |
| `src/provisioner.ts` | The provisioner's hooks. |
| `translations.json` | Every message a person reads, by token. |
| `test/` | Unit tests against real directories in a temporary directory. |

## Checking it

```sh
node scripts/check.mjs
```

It type-checks the sources against a Frontier checkout's Application Interface,
runs the tests with Node's test runner, and bundles `worker.ts` the way the Host
does. It looks for the checkout at `../../frontier`, or at `FRONTIER_REPO`.

## License

MIT
