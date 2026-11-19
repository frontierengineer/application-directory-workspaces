# Directories

A Frontier Workspace Provisioner that gives each workspace a plain directory of
its own on a worker. It is one of Frontier's Initial Applications, written
against Frontier's Application Interface (`interfaces/application.d.ts`) like
any other Application.

Its id is `github.com/frontierengineer/application-directory-workspaces`, the repository it
is published from.

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
  and the time of its last change. They answer within a call's wait: a
  directory too large to measure in 10 seconds is reported with no size.

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

## Developing

The Application is checked the way it ships, against a Frontier checkout:

```sh
npm test            # or: node scripts/check.mjs
```

It type-checks every bundle against the checkout's Application Interface
(`interfaces/application.d.ts`), runs the tests with Node's test runner, and
bundles each entry file the way the Host does. It finds the checkout at
`../../frontier` (a `frontier` beside the directory holding this repository), or
at `FRONTIER_REPO`, and borrows TypeScript, esbuild and Node's types from it,
so that checkout's dependencies must be installed. It needs Node.js 22.6 or
later. No test reaches the network; the tests work on real directories in a temporary directory.

To try it in Frontier itself, put this repository in the `applications`
directory beside a Frontier checkout, as `directory-workspaces`; a Source Build of that
checkout carries every Application there as an Initial Application, so a new
install starts with it. From the checkout, `bash modcon/scripts/tool.sh ui
--remake --applications <that directory>` makes the Electron app with them and
photographs it.

## License

MIT, as `LICENSE` states.
