# CLS Query Plugin

Tencent Cloud CLS log query plugin for zhiliao.

## Key Files

- `src/index.ts` — plugin entry point (implements ToolPlugin interface)
- `config.yaml` — local config with credentials and topics (gitignored)
- `config.example.yaml` — config template (tracked)
- `knowledge/CLAUDE.md` — authoring guide for topic knowledge files
- `knowledge/{topic}/` — per-topic knowledge (gitignored)

## Development

- This is an ESM project (`"type": "module"`)
- `tencentcloud-sdk-nodejs-cls` is CJS; imported via `createRequire`
- Plugin is loaded by zhiliao agent via symlink at `agent/plugins/cls-query`
- TypeScript checking: use `../zhiliao/agent/node_modules/.bin/tsc --noEmit`
- Integration testing: use `../zhiliao/agent/node_modules/.bin/tsx`

## Rules

- **Never commit `config.yaml`** — it contains deployment-specific topic IDs and credential references
- **Never commit files under `knowledge/*/`** — they may contain project-specific data
- **Evolve `docs/mistake.md`** — when a notable mistake happens (especially a pattern that could recur), add an entry. Focus on the recurring pattern and generalization, not the specific instance. Review existing entries before adding to avoid duplicates.
