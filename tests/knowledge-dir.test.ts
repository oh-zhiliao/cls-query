import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import CLSQueryPlugin from "../src/index.js";

const BASE_CONFIG = {
  secret_id: "AKIDxxxxxxxxxxxxxxxxxxxx",
  secret_key: "secretkeyyyyyyyyyyyyyyyyyyyyyyyy",
  default_region: "ap-nanjing",
  known_topics: {
    my_app: { topic_id: "11111111-2222-3333-4444-555555555555", region: "ap-nanjing" },
  },
};

describe("CLSQueryPlugin knowledge_dir override", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cls-kd-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads knowledge from the overridden directory", async () => {
    const topicDir = join(tmpDir, "my_app");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(
      join(topicDir, "_catalog.md"),
      "---\ndescription: test topic\n---\nCatalog body for my_app\n",
    );
    writeFileSync(
      join(topicDir, "errors.md"),
      "---\ntitle: Errors\ndescription: error field guide\n---\nError details here\n",
    );

    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await plugin.init({ ...BASE_CONFIG, knowledge_dir: tmpDir });

    // get_topic_knowledge should now be exposed (knowledge size > 0)
    const defs = plugin.getToolDefinitions();
    const kDef = defs.find((d) => d.name === "get_topic_knowledge");
    expect(kDef).toBeDefined();
    expect(kDef!.description).toContain("errors");

    // Reading the doc should succeed
    const out = await plugin.executeTool("get_topic_knowledge", {
      topic: "my_app",
      doc: "errors",
    });
    expect(out).toContain("Error details here");
  });

  it("silently skips when knowledge_dir does not exist", async () => {
    const missing = join(tmpDir, "does-not-exist");
    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    await expect(
      plugin.init({ ...BASE_CONFIG, knowledge_dir: missing }),
    ).resolves.toBeUndefined();

    // No get_topic_knowledge tool when no knowledge loaded
    const defs = plugin.getToolDefinitions();
    expect(defs.find((d) => d.name === "get_topic_knowledge")).toBeUndefined();
  });

  it("falls back to default when knowledge_dir not set", async () => {
    const plugin = new CLSQueryPlugin();
    plugin.name = "cls-query";
    // No knowledge_dir set — default is {plugin_root}/knowledge which has
    // no topic subdirs (gitignored), so no knowledge loads.
    await expect(plugin.init({ ...BASE_CONFIG })).resolves.toBeUndefined();
    const defs = plugin.getToolDefinitions();
    expect(defs.find((d) => d.name === "get_topic_knowledge")).toBeUndefined();
  });
});
