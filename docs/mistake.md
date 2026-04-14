# Mistake Log

Patterns of mistakes made during development, for future reference.

## Unbounded pagination without total cap

**Pattern**: Using a server's pagination mechanism (cursor/context-based) in a loop without capping total collected results. The `limit` parameter was passed directly as per-page size, but the loop kept fetching until the server said `ListOver`. For a busy topic, this means thousands of pages of 3 records each.

**Root cause**: Confusing "per-page size" with "total desired results". The API's `Limit` controls how many records come back per request, not how many you want overall.

**Fix**: Separate `limit` (total cap) from `perPage` (per-request size). Break the loop when `allResults.length >= limit`.

**Generalization**: Any time you wrap a paginated API, define both a per-page size and a total cap. Default the total cap to something safe (e.g. 1000).

---

## Committing deployment-specific config before adding gitignore

**Pattern**: Including a real config file (`config.yaml` with env-var references and topic structure) in the initial commit, then gitignoring it in a later commit. Even though this instance only had placeholders, the workflow order was wrong.

**Root cause**: Building the gitignore incrementally instead of upfront. The config file was created first for local testing, committed as part of "get it working", then gitignored as an afterthought.

**Fix**: Always set up `.gitignore` with `config.yaml` excluded before the first commit. Use `config.example.yaml` from the start.

**Generalization**: Files that will eventually be gitignored should never be tracked, even temporarily. Set up ignore rules before the first commit.

---

## Running CJS module in ESM context without compatibility shim

**Pattern**: Attempting to `import` a CommonJS-only npm package (`tencentcloud-sdk-nodejs-cls`) in an ESM project (`"type": "module"` in package.json), expecting it to just work.

**Root cause**: Not checking whether the dependency ships ESM or CJS before importing.

**Fix**: Use `createRequire(import.meta.url)` to get a CJS-compatible `require()` function in ESM context.

**Generalization**: Before adding a dependency, check its module format. If your project is ESM and the dep is CJS-only, use `createRequire`. If vice versa, use dynamic `import()`.

---

## Testing with shell `source` expecting env vars in subprocess

**Pattern**: Using `source .env` then running a Node.js process, expecting the vars to be available. `source` without `export` only sets shell-local variables.

**Root cause**: Assuming `source` exports variables. It only runs the file in the current shell -- variables are available in that shell but not inherited by child processes unless explicitly exported.

**Fix**: Use `export $(grep -v '^#' .env | xargs)` to both set and export variables.

**Generalization**: For passing env vars to subprocesses, always use `export`. Alternatively, use a tool like `dotenv` or `env $(cat .env) command`.

---

## Using wrong binary due to npx resolution

**Pattern**: Running `npx tsc` and getting a completely different package (`tsc@2.0.4`, a CoffeeScript tool) instead of the project's `typescript` compiler.

**Root cause**: `npx` resolves globally or fetches from npm if the command isn't found locally. The name `tsc` on npm is a different package from `typescript`'s `tsc` binary.

**Fix**: Use the project's local binary directly: `./node_modules/.bin/tsc` or `npx -p typescript tsc`.

**Generalization**: Never trust `npx <command>` to resolve to the expected package. Use explicit paths to local binaries, or `npx -p <package> <command>` to be explicit.
