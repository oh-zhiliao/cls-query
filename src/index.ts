import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { ToolPlugin, ToolDefinition } from "../../../src/agent/tool-plugin.js";

// tencentcloud-sdk-nodejs-cls is CJS, use createRequire for ESM compatibility
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tencentCls = require("tencentcloud-sdk-nodejs-cls");
const ClsClient = tencentCls.cls.v20201016.Client;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const DEFAULT_KNOWLEDGE_DIR = resolve(PLUGIN_ROOT, "knowledge");

interface KnownTopic {
  topic_id: string;
  region: string;
}

interface TopicDocMeta {
  title: string;
  description: string;
  filePath: string;
}

interface TopicKnowledge {
  description: string;
  catalogBody: string;
  docs: Map<string, TopicDocMeta>;
}

interface CLSQueryConfig {
  secret_id: string;
  secret_key: string;
  default_region: string;
  known_topics?: Record<string, KnownTopic>;
  /** Absolute path override for the knowledge directory. When set, overrides the
   *  default colocated `{plugin_root}/knowledge`. Useful for deploy environments
   *  that want knowledge files isolated from the plugin source tree. */
  knowledge_dir?: string;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      let val = line.slice(sep + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTime(timeStr: string): number {
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)$/,
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ];

  for (const fmt of formats) {
    const m = timeStr.match(fmt);
    if (m) {
      const year = parseInt(m[1]);
      const month = parseInt(m[2]) - 1;
      const day = parseInt(m[3]);
      const hour = parseInt(m[4] || "0");
      const minute = parseInt(m[5] || "0");
      const second = parseInt(m[6] || "0");
      const ms = m[7] ? parseInt(m[7].padEnd(3, "0").slice(0, 3)) : 0;
      return new Date(year, month, day, hour, minute, second, ms).getTime();
    }
  }
  throw new Error(`Cannot parse time: ${timeStr}. Supported: YYYY-MM-DD, YYYY-MM-DD HH:MM, YYYY-MM-DD HH:MM:SS`);
}

function isAnalysisQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return lower.includes("| select ") || lower.includes("|select ");
}

export default class CLSQueryPlugin implements ToolPlugin {
  name = "";
  private config!: CLSQueryConfig;
  private knowledge = new Map<string, TopicKnowledge>();
  private knowledgeDir = DEFAULT_KNOWLEDGE_DIR;

  async init(config: Record<string, any>): Promise<void> {
    if (!config.secret_id || config.secret_id.startsWith("${")) {
      throw new Error("TENCENTCLOUD_SECRET_ID not configured");
    }
    if (!config.secret_key || config.secret_key.startsWith("${")) {
      throw new Error("TENCENTCLOUD_SECRET_KEY not configured");
    }
    this.config = config as CLSQueryConfig;
    if (this.config.knowledge_dir) {
      this.knowledgeDir = this.config.knowledge_dir;
    }
    this.loadKnowledge();
  }

  async destroy(): Promise<void> {}

  private loadKnowledge(): void {
    if (!existsSync(this.knowledgeDir)) return;

    const topicNames = Object.keys(this.config.known_topics || {});
    for (const topicName of topicNames) {
      const topicDir = join(this.knowledgeDir, topicName);
      if (!existsSync(topicDir)) continue;

      const catalogPath = join(topicDir, "_catalog.md");
      if (!existsSync(catalogPath)) {
        console.warn(`Knowledge dir for "${topicName}" exists but missing _catalog.md, skipping`);
        continue;
      }

      const catalogContent = readFileSync(catalogPath, "utf-8");
      const { meta, body } = parseFrontmatter(catalogContent);

      const docs = new Map<string, TopicDocMeta>();
      const entries = readdirSync(topicDir);
      for (const entry of entries) {
        if (!entry.endsWith(".md") || entry === "_catalog.md" || entry === "CLAUDE.md") continue;
        const docName = entry.replace(/\.md$/, "");
        const docPath = join(topicDir, entry);
        const docContent = readFileSync(docPath, "utf-8");
        const docParsed = parseFrontmatter(docContent);
        docs.set(docName, {
          title: docParsed.meta.title || docName,
          description: docParsed.meta.description || "",
          filePath: docPath,
        });
      }

      this.knowledge.set(topicName, {
        description: meta.description || "",
        catalogBody: body.trim(),
        docs,
      });

      console.log(`  Knowledge loaded for "${topicName}": catalog + ${docs.size} docs`);
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    const topicsList = this.config.known_topics
      ? Object.entries(this.config.known_topics)
          .map(([name, t]) => {
            const k = this.knowledge.get(name);
            let line = `  - "${name}": topic_id=${t.topic_id}, region=${t.region}`;
            if (k?.description) line += ` — ${k.description}`;
            return line;
          })
          .join("\n")
      : "  (none configured)";

    const tools: ToolDefinition[] = [
      {
        name: "search",
        description: [
          "Search Tencent Cloud CLS (Cloud Log Service) logs. Use this tool when you need to query logs, troubleshoot online issues, or analyze log data.",
          "",
          "Supports two query modes:",
          "1. Plain search (CQL): filters logs by keywords/fields, auto-paginates to get all results",
          "2. SQL aggregation: when query contains '| select', returns aggregated analytics results",
          "",
          "CQL syntax examples: `level:ERROR`, `status>400`, `method:GET AND status>400`, `NOT level:INFO`",
          "SQL examples: `* | select count(*) as cnt`, `status>400 | select URL, count(*) as cnt group by URL order by cnt desc limit 10`",
          "",
          "Known topics:",
          topicsList,
          "",
          "You can use a known topic name instead of raw topic_id and region.",
          "Use get_topic_knowledge to load detailed knowledge docs (query patterns, analysis recipes) before writing complex queries.",
        ].join("\n"),
        input_schema: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Known topic name (e.g. 'my_app') OR raw topic_id UUID. When using a known topic name, region is auto-resolved.",
            },
            region: {
              type: "string",
              description: "CLS region (e.g. 'ap-nanjing', 'ap-guangzhou'). Optional if using a known topic name.",
            },
            from: {
              type: "string",
              description: "Start time. Formats: YYYY-MM-DD, YYYY-MM-DD HH:MM, YYYY-MM-DD HH:MM:SS",
            },
            to: {
              type: "string",
              description: "End time. Same formats as 'from'.",
            },
            query: {
              type: "string",
              description: "CQL query string. Use '| select ...' suffix for SQL aggregation. Default: '*' (all logs)",
              default: "*",
            },
            limit: {
              type: "number",
              description: "Results per request, max 1000. Default: 100",
              default: 100,
            },
            sort: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order by time. Default: desc",
              default: "desc",
            },
          },
          required: ["topic", "from", "to"],
        },
      },
    ];

    if (this.knowledge.size > 0) {
      const availableDocs = Array.from(this.knowledge.entries())
        .flatMap(([topic, k]) =>
          Array.from(k.docs.entries()).map(([doc, meta]) =>
            `  - topic="${topic}", doc="${doc}": ${meta.description || meta.title}`
          )
        )
        .join("\n");

      tools.push({
        name: "get_topic_knowledge",
        description: [
          "Load a detailed knowledge document for a CLS topic. Use this before writing complex queries to get field-specific patterns, SQL recipes, and investigation playbooks.",
          "",
          "Available docs:",
          availableDocs || "  (none)",
        ].join("\n"),
        input_schema: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Topic name (must match a known topic)",
            },
            doc: {
              type: "string",
              description: "Document name (without .md extension)",
            },
          },
          required: ["topic", "doc"],
        },
      });
    }

    return tools;
  }

  async executeTool(name: string, input: Record<string, any>): Promise<string> {
    switch (name) {
      case "search":
        return this.search(input);
      case "get_topic_knowledge":
        return this.getTopicKnowledge(input);
      default:
        return `Unknown tool: ${name}`;
    }
  }

  getCheapTools(): string[] {
    return ["get_topic_knowledge"];
  }

  summarizeInput(name: string, input: Record<string, any>): string {
    if (name === "get_topic_knowledge") {
      return `knowledge: ${input.topic}/${input.doc}`;
    }
    const topic = input.topic || "?";
    const query = input.query || "*";
    const from = input.from || "?";
    const to = input.to || "?";
    return `CLS search: ${topic} [${from} ~ ${to}] query="${query}"`;
  }

  getSystemPromptAddendum(): string {
    const lines: string[] = [
      "## CLS Log Query Plugin",
      "",
      `Use ${this.name}.search to query Tencent Cloud CLS logs.`,
      `Use ${this.name}.get_topic_knowledge to load detailed query patterns and analysis recipes on-demand.`,
      "",
      "General CQL/SQL tips:",
      "- Prefer SQL aggregation (query with '| select') over plain search for large datasets",
      "- Start with small time windows (5min) to verify query correctness, then expand",
      "- CQL part (before '|') does coarse filtering, SQL part (after '| select') does precise analysis",
      "- __TIMESTAMP__ is millisecond Unix timestamp",
      "- SQL string literals must use single quotes, double quotes are for column names",
      "- CQL treats slashes as AND: `/v1/app_config` matches `v1 AND app_config`. Use quotes for exact match.",
      "",
      "### Query transparency",
      "When presenting CLS results to the user, ALWAYS include:",
      "- The CQL/SQL query you used (in a code block) so the user can review your query logic",
      "- A brief explanation of query intent — what you were looking for and why this query captures it",
      "- If the query returned unexpected or empty results, explain what you tried and suggest alternatives",
      "",
      "### Cross-verification",
      "After getting CLS results, cross-verify with git repo code when relevant:",
      "- If logs show a certain behavior, check the source code to confirm the logic matches",
      "- If log fields or values look unexpected, check the code that produces them",
      "- Flag discrepancies between log data and code — the user needs to know",
    ];

    if (this.knowledge.size > 0) {
      lines.push("", "### Known Topics");
      for (const [topicName, k] of this.knowledge.entries()) {
        const topic = this.config.known_topics?.[topicName];
        const regionStr = topic ? ` (${topic.region})` : "";
        lines.push("", `**${topicName}**${regionStr}`);
        if (k.catalogBody) {
          lines.push(k.catalogBody);
        }
      }
    } else if (this.config.known_topics) {
      lines.push("", "### Known Topics", "");
      for (const [name, t] of Object.entries(this.config.known_topics)) {
        lines.push(`- **${name}**: ${t.topic_id} (${t.region})`);
      }
    }

    return lines.join("\n");
  }

  getSecretPatterns(): RegExp[] {
    const patterns: RegExp[] = [];
    if (this.config.secret_id) {
      patterns.push(new RegExp(escapeRegex(this.config.secret_id), "g"));
    }
    if (this.config.secret_key) {
      patterns.push(new RegExp(escapeRegex(this.config.secret_key), "g"));
    }
    return patterns;
  }

  private resolveTopicAndRegion(input: Record<string, any>): { topicId: string; region: string } {
    const topicInput: string = input.topic;
    const knownTopics = this.config.known_topics || {};

    if (knownTopics[topicInput]) {
      const known = knownTopics[topicInput];
      return {
        topicId: known.topic_id,
        region: input.region || known.region,
      };
    }

    const region = input.region || this.config.default_region;
    if (!region) {
      throw new Error("Region is required when using a raw topic_id (not a known topic name)");
    }
    return { topicId: topicInput, region };
  }

  private getTopicKnowledge(input: Record<string, any>): string {
    const topicName: string = input.topic;
    const docName: string = input.doc;

    const topicKnowledge = this.knowledge.get(topicName);
    if (!topicKnowledge) {
      const available = Array.from(this.knowledge.keys()).join(", ");
      return `No knowledge found for topic "${topicName}". Available topics with knowledge: ${available || "(none)"}`;
    }

    const docMeta = topicKnowledge.docs.get(docName);
    if (!docMeta) {
      const available = Array.from(topicKnowledge.docs.keys()).join(", ");
      return `No doc "${docName}" for topic "${topicName}". Available docs: ${available || "(none)"}`;
    }

    try {
      return readFileSync(docMeta.filePath, "utf-8");
    } catch (err: any) {
      return `Error reading knowledge file: ${err.message}`;
    }
  }

  private buildClient(region: string): any {
    return new ClsClient({
      credential: {
        secretId: this.config.secret_id,
        secretKey: this.config.secret_key,
      },
      region,
      profile: {
        httpProfile: { endpoint: "cls.tencentcloudapi.com" },
      },
    });
  }

  private async search(input: Record<string, any>): Promise<string> {
    try {
      const { topicId, region } = this.resolveTopicAndRegion(input);
      const fromTs = parseTime(input.from);
      const toTs = parseTime(input.to);
      const query: string = input.query || "*";
      const limit: number = Math.min(input.limit || 100, 1000);
      const sort: string = input.sort || "desc";
      const useAnalysis = isAnalysisQuery(query);

      const client = this.buildClient(region);
      const allResults: any[] = [];
      let context: string | undefined;
      const perPage = Math.min(limit, 100);

      while (true) {
        const params: Record<string, any> = {
          TopicId: topicId,
          From: fromTs,
          To: toTs,
          QueryString: query,
          Limit: perPage,
          Sort: sort,
          QuerySyntax: 1,
          UseNewAnalysis: true,
        };
        if (context) params.Context = context;

        const resp = await client.SearchLog(params);

        if (useAnalysis) {
          const records: string[] = resp.AnalysisRecords || [];
          for (const r of records) {
            try {
              allResults.push(JSON.parse(r));
            } catch {
              allResults.push({ raw: r });
            }
          }
          break;
        } else {
          const results: any[] = resp.Results || [];
          for (const r of results) {
            if (r.LogJson) {
              try {
                r.LogJson = JSON.parse(r.LogJson);
              } catch { /* keep as string */ }
            }
            allResults.push(r);
          }

          if (allResults.length >= limit || resp.ListOver || !resp.Context) break;
          context = resp.Context;
        }
      }

      if (allResults.length === 0) {
        return [
          `## Query Used`,
          `topic: ${input.topic}`,
          `time: ${input.from} ~ ${input.to}`,
          `query: ${query}`,
          ``,
          `No results found.`,
          ``,
          `You MUST show the query above to the user and explain what it searched for. Suggest alternative queries.`,
        ].join("\n");
      }

      const header = [
        `## Query Used (MUST include in your answer)`,
        `topic: ${input.topic}`,
        `time: ${input.from} ~ ${input.to}`,
        `query: ${query}`,
        `results: ${allResults.length} rows`,
        ``,
        `When answering: (1) show this query in a code block, (2) explain what it does, (3) cross-verify with source code if relevant.`,
        ``,
        `## Data`,
      ].join("\n");

      return header + "\n" + JSON.stringify(allResults, null, 2);
    } catch (err: any) {
      return `Error in ${this.name}.search: ${err.message}`;
    }
  }
}
