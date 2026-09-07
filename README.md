# ai-model-configure

Route OpenCode's agents **per directory** — cloud where you want it,
local where you need it, different rules per client or project — with
named variants, direnv, and zero config drift.

<!-- markdownlint-disable MD014 -->
```console
$ cd ~/work/acme                      # client tree: company rules
$ ai-model-configure use hybrid       # plan: copilot/premium *high
$ opencode                            # models follow the directory

$ cd ~/side/auto-notes                # same laptop, personal rules
$ ai-model-configure use all-local    # everything on-box
$ opencode

$ ai hybrid serve                     # or launch any variant from anywhere
```
<!-- markdownlint-enable MD014 -->

**Why**: one global `opencode.json` forces one model policy everywhere.
Work trees want premium reasoning and locked providers; side projects
want free local models; experiments want a one-off override *just here*.
`ai-model-configure` makes your directory the switch.

**How**:

- Each project root gets a managed `.envrc` exporting
  `OPENCODE_CONFIG_CONTENT` — OpenCode's own config-injection hook — so
  `cd` alone changes the routing. Your `opencode.json` is never written;
  credentials, endpoints, and provider definitions stay yours.
- Routing lives in small JSON **variants** (role → model + reasoning
  effort + optional provider restrictions), created by an arrow-key
  wizard that shows real models with context limits, $/Mtok pricing,
  and reasoning efforts.
- Variants resolve **by directory tree**: the nearest
  `.ai-model-configure/variants/` store wins, so `~/work` can carry its
  own `hybrid` while everything else uses the global one. Two shared
  slots (`model-reasoning`, `model-fast`) move whole fleets of
  directories with one `models set`.

Hand-edit a generated file and it's detected, protected, and reported —
never silently overwritten.

## Requirements

- Node >= 20
- [direnv](https://direnv.net) with its shell hook active in your shell rc,
  e.g. `eval "$(direnv hook zsh)"` in `~/.zshrc`
- `opencode` on `PATH` (optional) — the wizard queries `opencode models
  --verbose` to list every model you can actually use, with its limits,
  price, and reasoning efforts

## Install

### Homebrew

```sh
brew tap <you>/tools
brew install <you>/tools/ai-model-configure
```

Installs three commands: `ai-model-configure`, `ai`, and `ai-cost`.
The formula lives in this repo at `Formula/ai-model-configure.rb`
(also the source of the tap); point `url`/`homepage` at the release
archive when cutting a tag.

### npm / direct

```sh
npm install -g .
```

or add `bin/` to your `PATH`.

## Usage

Commands act on the current working directory (a project root).

- `ai-model-configure init [--variant NAME]` (or `--variant=NAME`)
  Establish a NEW environment path: writes a managed `.envrc` and runs
  `direnv allow`; children inherit this environment from here. With a
  known variant it only binds that variant; otherwise the wizard
  (interactive terminal) creates one and it is PAIRED with this
  directory — the definition lands in `./.ai-model-configure/variants/`
  next to the `.envrc` (`--global` stores the definition globally; a
  same-named variant higher up is shadowed, not touched).
- `ai-model-configure add`
  Contribute a variant to the environment you're standing in: runs the
  wizard and saves the definition into the nearest
  `.ai-model-configure/variants` store walking up (global store if
  there is no tree here). Applies nothing — bind directories with
  `use <name>`. Requires a TTY.
- `ai-model-configure use [variant]`
  Switch this directory. Without an argument, list variants (tier,
  description, which directories use each). The alias
  `ai-model-configure variants` lists as well.
- `ai-model-configure edit [variant]`
  Re-run the wizard with name/description/roles prefilled — from the
  named variant, or from the one *loaded here* (this directory's, else
  the nearest parent's; edits to a parent's variant save in place). The
  variant you enter is saved and every directory using it regenerates.
  Requires a TTY.
- `ai-model-configure fork [variant]`
  Alternative to the parent's setup: copy the loaded (or named) variant
  into a NEW variant (wizard prefilled, new name), saved beside the
  original in the same store — so the whole tree can `use` it — and
  applied here. Independent from the original afterwards. Requires a
  TTY.
- `ai-model-configure patch <role> <provider/model>`
  Quick one-role change for immediate use, no wizard. On a directory
  with its own variant it updates that variant in place; in an unmanaged
  subdirectory it forks the nearest parent's variant as
  `<variant>-<role>`, saved beside it and applied here.
- `ai-model-configure restrict [variant]`
  Change only the restrictions (disabled providers, per-provider model
  allow/deny) of an existing variant — defaults to this directory's
  variant. Enter keeps a value, `-` clears it. Requires a TTY.
- `ai-model-configure models`
  Show the two slots: `model-reasoning`, `model-fast` (values start
  unset).
- `ai-model-configure models refresh`
  Refresh the cached model catalog (your `opencode.json` + models.dev).
- `ai-model-configure models set <slot> <provider/model>`
  One command to move a slot; every managed directory whose variant
  references it regenerates.
- `ai-model-configure status`
  The environment chain in effect for the current directory only: this
  directory and its parent environments, each with active variant and
  drift state (`ok` / `drifted` / `missing .envrc` / `variant missing`)
  — plus the variants visible from here: global where nothing
  overrides, parent environments where not overloaded, and the current
  scope, nearest match wins, each marked with its store and `(in use)`
  in green. Child environments are excluded unless `--all`.
- `ai-model-configure show <variant>` (alias `log`; defaults to this
  directory's variant)
  Pretty-print a variant: `role -> provider/model (via slot) * effort`
  per agent, plus where it's applied and its restrictions. Slot-backed
  roles show the currently resolved model (red when the slot is unset).
- `ai-model-configure rm <variant>`
  Delete a variant file (the tree-scoped one if a shadow resolves from
  here). Refuses while directories still reference it unless `--force`.
- `ai-model-configure unmanage [dir…]` (alias `detach`)
  Detach directories (default: this one): delete the generated `.envrc`
  and the selector file and drop the registry entry. A drifted or
  hand-written `.envrc` is kept, never deleted.
- `ai-model-configure prune [--force]`
  Clean the registry: drop entries whose directory is gone or whose
  `.envrc`/selector were already deleted by hand. With `--force`, also
  fully unmanage directories whose variant no longer exists (the usual
  aftermath of deleting a variant file).
- `ai-model-configure help`
  Show usage. Running with no arguments shows the same help.
- `ai <variant> [opencode args…]`
  Launch opencode with the variant's routing config injected into its
  environment (a config container — works from any directory, no
  direnv/`.envrc` involvement for the launch). Any extra args are passed
  to opencode; `ai` with no args lists variants. An unset slot fails
  loudly before anything launches.
- `ai-cost [provider]`
  Separate command: model prices (USD per million tokens, from
  `opencode models --verbose`) grouped by provider; free and unknown
  prices are labelled. Pass a provider to filter.
- `--force` (any position)
  Overwrite a hand-edited (drifted) `.envrc`, saving the old file as
  `.envrc.drifted-backup` first.

### Examples

```sh
cd ~/code/projects/foo
ai-model-configure init            # wizard (or: init --variant my-tier)
direnv reload                      # activate now
ai-model-configure use my-tier     # switch later
ai-model-configure models set model-fast acme/fast-llama
ai-model-configure status
```

## How the wizard builds a variant

1. It reflects your current setup back to you: every agent (built-ins plus
   your custom ones) with its currently resolved model and mode.
2. You name the variant, enter a description, and pick an **intent**
   (`all-cloud`, `hybrid`, or `all-local`) from an arrow-key menu. Intent
   decides only how roles are *placed*, never which models exist.
3. Per role you choose from an arrow-key menu — the **default** (your
   current model, or the intent's placement) is first, then the two
   slots, then your providers. Choose a provider and you get its models,
   each showing context/output limits, price ($/Mtok in/out), and
   supported reasoning efforts. The catalog comes from
   `opencode models --verbose` (always the full list — your real config,
   never the per-directory injection), your opencode provider
   definitions, and the models.dev cache.

   Each menu: ↑/↓ move, type to filter, Enter/Space picks, Esc re-asks.

   | intent     | plan, reviewer   | build, explore   | executor, general |
   |------------|------------------|------------------|-------------------|
   | all-cloud  | reasoning        | reasoning        | fast (slot)       |
   | hybrid     | reasoning        | reasoning (slot) | fast (slot)       |
   | all-local  | reasoning (slot) | reasoning (slot) | fast (slot)       |

   Slot-placed roles reference `model-reasoning`/`model-fast`, so
   `models set` moves them everywhere at once.

4. Whenever the model behind a role supports reasoning efforts (`low`,
   `high`, `xhigh`, `thinking`, …) a final menu asks for **that agent's**
   effort, with `(none)` first. The effort is stored per role, so each
   agent can run a different one.

5. If a role uses a slot that has no model yet, you pick one from the
   same provider/model menus. Esc leaves it unset (roles using it fail
   until `models set <slot> <provider/model>`).

6. Optional restrictions, chosen from what opencode reports for *you*:
   disable providers (e.g. `beta, acme`, or `only:a,b` to keep just
   those two), and per-provider model allow/deny one rule per line
   (`acme=only:big,small`, `beta=except:quick` — `acme=only:acme/big`
   works too). These land in the variant and generate
   `disabled_providers` / `provider.<id>.whitelist` / `blacklist` keys.

## State and environment variables

```text
~/.config/ai-model-configure/
├── slots.json          # model-reasoning / model-fast (null = unset)
├── models.json         # model catalog cache
├── variants/*.json     # your variants, nothing seeded
└── dirs.json           # registry of managed directories
```

Per managed directory: `.envrc` (generated) and
`.ai-model-configure.json` (selector recording the active variant).

### Tree-scoped variants

Variants resolve by walking up from your directory: the nearest
`<dir>/.ai-model-configure/variants/<name>.json` shadows the global
store, so a variant named `hybrid` defined under `~/work` applies to
that tree while `~` (and everywhere else) keeps its own `hybrid`. The
shadowing file is authoritative — a corrupt one errors rather than
falling back. `init` stores new variants in the directory it runs in
(`--global` stores in the global directory instead); `edit`/`restrict`
re-save where the variant was resolved from; `variants`/`show` mark
scoped entries with their tree path. Slot values (`models set`) stay
global.

| Variable           | Purpose                                 |
|--------------------|-----------------------------------------|
| `AMC_HOME`         | Relocate the state directory            |
| `AMC_DIRENV`       | Path to the `direnv` binary             |
| `AMC_OPENCODE_BIN` | Path to the `opencode` binary (wizard)  |

## Generated file protection

Every managed `.envrc` starts with a
`# managed-by: ai-model-configure <variant> @<sha256>` marker whose hash
covers the body. Hand-edit the body and regeneration refuses to touch the
file until `--force` (which backs the old file up first). Bulk
regenerations (`models set`, `edit`) skip drifted directories, report
each, and exit 1 so the rest still update.

## Development

```sh
npm test
```

Zero runtime dependencies; tests use `node:test` only and never touch your
real state directory or invoke direnv.

## License

MIT
