# Knowledge File System Design

## Problem

Topic knowledge (fields, conventions, query patterns) is inline in `config.yaml` and fully dumped into the system prompt every turn. This wastes tokens and makes it hard for external agents to maintain.

## Goals

1. Knowledge lives in standalone files — easy for external agents to create/update
2. On-demand loading — only the catalog is in the system prompt; deep docs loaded via tool call
3. Clear authoring guide (`CLAUDE.md`) so external agents understand the structure

## Architecture

### Three-layer system prompt composition

| Layer | Source | Loading | Content |
|---|---|---|---|
| Plugin-level | hardcoded in `getSystemPromptAddendum` | always | CQL/SQL syntax, general tips, tool usage instructions |
| Topic catalog | `knowledge/{topic}/_catalog.md` body | always (per configured topic) | fields, project-specific conventions, doc index with one-line summaries |
| Task-based docs | `knowledge/{topic}/{doc}.md` | on-demand via `get_topic_knowledge` tool | deep query patterns, analysis recipes, investigation playbooks |

### Directory structure

```
cls-query/
  config.yaml
  knowledge/                          # gitignored, managed by external agent or separate repo
    CLAUDE.md                         # authoring guide for external agents
    my_app/                      # directory name = topic key in config.yaml
      _catalog.md                     # required: fields, conventions, doc index
      error-analysis.md               # optional: task-based knowledge doc
      latency-investigation.md
      device-tracking.md
    another_topic/
      _catalog.md
      ...
```

### config.yaml changes

Strip all knowledge fields. Topics keep only identity:

```yaml
secret_id: "${TENCENTCLOUD_SECRET_ID}"
secret_key: "${TENCENTCLOUD_SECRET_KEY}"
default_region: "ap-nanjing"

known_topics:
  my_app:
    topic_id: "your-topic-id-here"
    region: "ap-nanjing"
```

Knowledge is discovered from `knowledge/{topic_name}/` matching the key in `known_topics`. Topics without a knowledge directory still work — just no enriched context.

### _catalog.md format

```markdown
---
description: Application logs for my_app service
---

## Fields

- `level`: Log level (ERROR, WARNING, INFO, DEBUG)
- `status`: HTTP status code (int)
- `method`: HTTP method (GET, POST, etc.)
- `URL`: Request URL path

## Conventions

- Project-specific rules go here
- Data format notes (e.g. "timestamps are UTC+8")

## Available Docs

- **error-analysis**: Error rate aggregation, spike detection, top errors by URL
- **latency-investigation**: Slow request patterns, timeout correlation, p99 queries
```

Frontmatter `description` is used in the tool description's topic list. Body is appended to the system prompt under a `### {topic_name}` heading.

### Task-based doc format

```markdown
---
title: Error Analysis Patterns
description: SQL patterns for error rate aggregation, spike detection, and top errors by URL
---

### Error rate by minute

\`\`\`
level:ERROR | select histogram(__TIMESTAMP__, interval 1 minute) as t, count(*) as cnt group by t limit 1000
\`\`\`

### Top 10 error URLs

\`\`\`
level:ERROR | select URL, count(*) as cnt group by URL order by cnt desc limit 10
\`\`\`

...
```

Frontmatter `title` and `description` are used in auto-discovery. Content is returned verbatim by the `get_topic_knowledge` tool.

### New tool: `get_topic_knowledge`

| Property | Value |
|---|---|
| Name | `get_topic_knowledge` |
| Input | `{ topic: string, doc: string }` |
| Output | File content as string, or error message |
| Cheap | Yes (local file read) |

The `doc` parameter matches the filename without `.md` extension. Example: `get_topic_knowledge({ topic: "my_app", doc: "error-analysis" })`.

### Auto-discovery

At `init()`, for each topic in `known_topics`:

1. Check if `knowledge/{topic}/` directory exists
2. If yes, read `_catalog.md` — parse frontmatter for `description`, store body for system prompt
3. Scan for other `.md` files (excluding `_catalog.md`, `CLAUDE.md`), read their frontmatter
4. If a doc file exists but is not mentioned in the catalog's "Available Docs" section, log a warning and still include it in the tool's available docs list

### knowledge/CLAUDE.md

Guide for external agents. Contents:

- Purpose of the knowledge directory
- How to add a new topic: create `{topic_name}/` dir, add `_catalog.md` with required frontmatter and sections (Fields, Conventions, Available Docs)
- How to add a doc: create `{name}.md` with frontmatter (`title`, `description`), add entry to parent `_catalog.md` Available Docs section
- How to update: edit in place, keep frontmatter in sync with content
- Format rules: frontmatter is YAML between `---` fences, body is markdown

### Plugin code changes

1. **`KnownTopic` interface**: remove `description`, `fields`, `example_queries` — these move to knowledge files
2. **New `TopicKnowledge` interface**: `{ description: string; catalogBody: string; docs: Map<string, { title: string; description: string; filePath: string }> }`
3. **`init()`**: after config validation, scan `knowledge/` dir and build `TopicKnowledge` map
4. **`getToolDefinitions()`**: add `get_topic_knowledge` tool; update `search` tool description to list topics with descriptions from catalog frontmatter
5. **`getSystemPromptAddendum()`**: Layer 1 (CQL/SQL tips) stays hardcoded; Layer 2 appends each topic's catalog body under `### {topic_name}`
6. **`executeTool()`**: handle `get_topic_knowledge` — read and return file content
7. **`getCheapTools()`**: include `get_topic_knowledge`

### .gitignore

Add `knowledge/` to the plugin's `.gitignore`. The knowledge directory is either:
- Managed as a separate git repo (submodule or standalone clone)
- Populated by an external agent at deploy time
- Manually maintained by operators
