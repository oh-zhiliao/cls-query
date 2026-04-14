# CLS Query Knowledge Authoring Guide

This directory contains topic-specific knowledge for the CLS query plugin. The knowledge is loaded by the zhiliao agent to help it write better CLS queries.

## Structure

```
knowledge/
  CLAUDE.md                     # this file
  {topic_name}/                 # directory name must match key in config.yaml known_topics
    _catalog.md                 # required: fields, conventions, doc index (always loaded into system prompt)
    {doc-name}.md               # optional: task-based knowledge docs (loaded on-demand)
```

## Adding a New Topic

1. Create a directory matching the topic name in `config.yaml`
2. Create `_catalog.md` with the required format (see below)
3. Optionally add task-based doc files

## _catalog.md Format

```markdown
---
description: One-line description of what this topic contains
---

## Fields

- `field_name`: What it is, type, and query tips
- `another_field`: Description

## Conventions

- Project-specific rules (e.g. "trace_id is 32-char hex")
- Data format notes (e.g. "timestamps are UTC+8")
- Naming patterns (e.g. "container names follow {service}-{env}")

## Available Docs

- **doc-name**: One-line description of what patterns/recipes this doc contains
- **another-doc**: Description
```

**Important**: The catalog body (Fields, Conventions, Available Docs sections) is loaded into the agent's system prompt on every turn. Keep it concise — list field names with brief descriptions, not full query examples. Put detailed examples in task-based docs instead.

## Task-Based Doc Format

Organize docs by what the agent is trying to accomplish, not by knowledge type:

```markdown
---
title: Human-Readable Title
description: One-line description (shown in tool's available docs list)
---

### Pattern Name

Brief explanation of when to use this pattern.

\`\`\`
CQL/SQL query example
\`\`\`

### Another Pattern

...
```

**Good doc names** (task-oriented): `error-analysis`, `latency-investigation`, `device-tracking`, `traffic-stats`

**Bad doc names** (type-oriented): `queries`, `fields`, `examples` — these belong in `_catalog.md`

## Updating Knowledge

- Edit files in place. The plugin reads them at startup.
- Keep `_catalog.md` frontmatter `description` in sync with content.
- Keep the "Available Docs" section in `_catalog.md` in sync with actual doc files.
- If you add a new `.md` file, add a corresponding entry in the Available Docs section.
- Auto-discovery: doc files not listed in the catalog will still be found (with a warning log), but listing them ensures proper descriptions.

## What Goes Where

| Content | Location | Why |
|---|---|---|
| Field names + types | `_catalog.md` Fields section | Always needed for any query |
| Project-specific conventions | `_catalog.md` Conventions section | Always relevant context |
| Doc index with summaries | `_catalog.md` Available Docs section | LLM decides what to load |
| CQL/SQL syntax rules | Plugin code (shared across all topics) | Not topic-specific |
| Complex query patterns | Task-based doc files | Loaded on-demand to save tokens |
| Investigation playbooks | Task-based doc files | Loaded on-demand when needed |
