# pi-reuse-model

A [pi](https://github.com/earendil-works/pi) extension that starts every fresh session (`/new`, reopening a workspace) on the model and thinking level you last used in this workspace, instead of the configured defaults.

## Install

```sh
pi install npm:pi-reuse-model
```

Or load it with `--extension ./src/index.ts`, like any pi extension.

## Behavior

- Changing the model or thinking level records the selection in `~/.pi/agent/pi-reuse-model.json`, keyed by workspace directory.
- On `session_start` (`startup` or `new`) the recorded model is restored through `pi.setModel()`, then the recorded thinking level through `pi.setThinkingLevel()`. `resume`/`fork` already restore from the session transcript and are left alone.
- Restore is skipped when the command line pins a model (`--model`, `--models`, `--provider`) or the session already runs the recorded model or level. A model missing from the registry or lacking provider auth falls back to the resolved default while the thinking level still restores; an unknown recorded level is dropped.

## Similar extensions

[pi-remember-model](https://www.npmjs.com/package/pi-remember-model) and [pi-remember-last-model](https://github.com/aliceisjustplaying/pi-remember-last-model) keep a single global slot; this one remembers per workspace.

## Development

```sh
pnpm install
pnpm verify # fmt + lint + typecheck + test
```
