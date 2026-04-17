import { describe, it, expect, beforeEach } from "vitest";
import CLSQueryPlugin from "../src/index.js";

const VALID_CONFIG = {
  secret_id: "AKIDxxxxxxxxxxxxxxxxxxxx",
  secret_key: "secretkeyyyyyyyyyyyyyyyyyyyyyyyy",
  default_region: "ap-nanjing",
  known_topics: {
    my_app: { topic_id: "11111111-2222-3333-4444-555555555555", region: "ap-nanjing" },
    other_app: { topic_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", region: "ap-guangzhou" },
  },
};

describe("CLSQueryPlugin.init", () => {
  it("rejects missing secret_id", async () => {
    const plugin = new CLSQueryPlugin();
    await expect(plugin.init({ ...VALID_CONFIG, secret_id: "" })).rejects.toThrow(
      "TENCENTCLOUD_SECRET_ID not configured",
    );
  });

  it("rejects unresolved ${} placeholder in secret_id", async () => {
    const plugin = new CLSQueryPlugin();
    await expect(
      plugin.init({ ...VALID_CONFIG, secret_id: "${TENCENTCLOUD_SECRET_ID}" }),
    ).rejects.toThrow("TENCENTCLOUD_SECRET_ID not configured");
  });

  it("rejects missing secret_key", async () => {
    const plugin = new CLSQueryPlugin();
    await expect(plugin.init({ ...VALID_CONFIG, secret_key: "" })).rejects.toThrow(
      "TENCENTCLOUD_SECRET_KEY not configured",
    );
  });

  it("rejects unresolved ${} placeholder in secret_key", async () => {
    const plugin = new CLSQueryPlugin();
    await expect(
      plugin.init({ ...VALID_CONFIG, secret_key: "${TENCENTCLOUD_SECRET_KEY}" }),
    ).rejects.toThrow("TENCENTCLOUD_SECRET_KEY not configured");
  });

  it("succeeds with valid config", async () => {
    const plugin = new CLSQueryPlugin();
    await expect(plugin.init({ ...VALID_CONFIG })).resolves.toBeUndefined();
  });

  it("succeeds without known_topics", async () => {
    const plugin = new CLSQueryPlugin();
    const cfg = { ...VALID_CONFIG };
    delete (cfg as any).known_topics;
    await expect(plugin.init(cfg)).resolves.toBeUndefined();
  });
});

describe("CLSQueryPlugin.getToolDefinitions", () => {
  let plugin: CLSQueryPlugin;

  beforeEach(async () => {
    plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...VALID_CONFIG });
  });

  it("always exposes the search tool", () => {
    const defs = plugin.getToolDefinitions();
    const search = defs.find((d) => d.name === "search");
    expect(search).toBeDefined();
    expect(search!.description).toMatch(/CLS/);
    expect((search!.input_schema as any).required).toEqual(["topic", "from", "to"]);
  });

  it("lists known topics inside the search tool description", () => {
    const defs = plugin.getToolDefinitions();
    const search = defs.find((d) => d.name === "search")!;
    expect(search.description).toContain("my_app");
    expect(search.description).toContain("other_app");
    expect(search.description).toContain("ap-nanjing");
    expect(search.description).toContain("ap-guangzhou");
  });

  it("does not emit get_topic_knowledge when no knowledge docs are loaded", () => {
    // tests/ runs outside deployment dir — no knowledge/ files exist in source tree,
    // so the plugin reports only search.
    const defs = plugin.getToolDefinitions();
    expect(defs.find((d) => d.name === "get_topic_knowledge")).toBeUndefined();
  });

  it("tool definitions expose valid JSON Schema required fields", () => {
    const defs = plugin.getToolDefinitions();
    for (const def of defs) {
      const schema = def.input_schema as any;
      expect(schema.type).toBe("object");
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.properties).toBeDefined();
    }
  });
});

describe("CLSQueryPlugin.getSecretPatterns", () => {
  it("masks both secret_id and secret_key", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({ ...VALID_CONFIG });
    const patterns = plugin.getSecretPatterns();
    expect(patterns).toHaveLength(2);
    const sample = `id=${VALID_CONFIG.secret_id} key=${VALID_CONFIG.secret_key}`;
    let out = sample;
    for (const p of patterns) out = out.replace(p, "[REDACTED]");
    expect(out).toBe("id=[REDACTED] key=[REDACTED]");
  });

  it("escapes regex metacharacters in secret values", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({
      ...VALID_CONFIG,
      secret_id: "abc.+?*",
      secret_key: "k[e]y(1)",
    });
    const patterns = plugin.getSecretPatterns();
    // Must match literal, not treat as regex
    expect("abc.+?*".match(patterns[0])?.[0]).toBe("abc.+?*");
    expect("k[e]y(1)".match(patterns[1])?.[0]).toBe("k[e]y(1)");
    // Should not match arbitrary alternatives
    expect("abcDEF".match(patterns[0])).toBeNull();
  });
});

describe("CLSQueryPlugin.getCheapTools", () => {
  it("flags get_topic_knowledge as cheap", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({ ...VALID_CONFIG });
    expect(plugin.getCheapTools()).toContain("get_topic_knowledge");
  });

  it("does NOT flag search as cheap (real API call)", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({ ...VALID_CONFIG });
    expect(plugin.getCheapTools()).not.toContain("search");
  });
});

describe("CLSQueryPlugin.summarizeInput", () => {
  let plugin: CLSQueryPlugin;

  beforeEach(async () => {
    plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...VALID_CONFIG });
  });

  it("formats search summary with topic/time/query", () => {
    const s = plugin.summarizeInput("search", {
      topic: "my_app",
      from: "2026-04-17 00:00",
      to: "2026-04-17 01:00",
      query: "level:ERROR",
    });
    expect(s).toContain("my_app");
    expect(s).toContain("level:ERROR");
    expect(s).toContain("2026-04-17 00:00");
  });

  it("falls back to '?' for missing fields", () => {
    const s = plugin.summarizeInput("search", {});
    expect(s).toContain("?");
  });

  it("formats get_topic_knowledge summary", () => {
    const s = plugin.summarizeInput("get_topic_knowledge", {
      topic: "my_app",
      doc: "errors",
    });
    expect(s).toBe("knowledge: my_app/errors");
  });
});

describe("CLSQueryPlugin.getSystemPromptAddendum", () => {
  it("mentions the plugin's namespaced tools", async () => {
    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...VALID_CONFIG });
    const addendum = plugin.getSystemPromptAddendum();
    expect(addendum).toContain("cls-query.search");
    expect(addendum).toContain("cls-query.get_topic_knowledge");
  });

  it("includes CQL/SQL guidance", async () => {
    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...VALID_CONFIG });
    const addendum = plugin.getSystemPromptAddendum();
    expect(addendum).toMatch(/CQL/);
    expect(addendum).toMatch(/SQL/);
    expect(addendum).toContain("__TIMESTAMP__");
  });

  it("lists known topics when no knowledge docs loaded", async () => {
    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...VALID_CONFIG });
    const addendum = plugin.getSystemPromptAddendum();
    expect(addendum).toContain("my_app");
    expect(addendum).toContain("other_app");
  });
});

describe("CLSQueryPlugin.executeTool", () => {
  it("returns 'Unknown tool' for unrecognized names", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({ ...VALID_CONFIG });
    const out = await plugin.executeTool("does_not_exist", {});
    expect(out).toContain("Unknown tool: does_not_exist");
  });

  it("get_topic_knowledge returns friendly message when topic missing", async () => {
    const plugin = new CLSQueryPlugin();
    await plugin.init({ ...VALID_CONFIG });
    const out = await plugin.executeTool("get_topic_knowledge", {
      topic: "nonexistent",
      doc: "any",
    });
    expect(out).toContain("No knowledge found for topic");
    expect(out).toContain("nonexistent");
  });
});
