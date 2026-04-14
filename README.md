# CLS Query — 知了日志查询插件

腾讯云 CLS（日志服务）查询插件，为[知了](https://github.com/git-zhiliao/zhiliao) Agent 提供日志搜索和分析能力。

> [English version](README_EN.md)

## 功能

- **日志搜索**：通过 CQL 语法检索日志，自动分页获取全部结果
- **SQL 聚合分析**：支持 `| select` 语法进行统计分析，返回聚合结果
- **知识库系统**：三层知识加载机制，按需加载查询模式，节省 token 开销
- **已知 Topic 映射**：通过友好名称引用 Topic，无需记忆 UUID

## 提供的工具

| 工具名 | 说明 | 开销 |
|---|---|---|
| `cls-query.search` | 搜索 CLS 日志（CQL 检索 / SQL 聚合） | expensive |
| `cls-query.get_topic_knowledge` | 按需加载 topic 的详细查询模式文档 | cheap |

## 目录结构

```
cls-query/
  config.yaml              # 凭证 + topic 注册（仅 topic_id + region）
  config.example.yaml      # 配置模板
  src/index.ts             # TypeScript 插件入口
  package.json             # 依赖（tencentcloud-sdk-nodejs-cls）
  knowledge/               # 知识库目录（gitignored，独立管理）
    CLAUDE.md              # 知识库编写指南
    {topic_name}/
      _catalog.md          # 字段、约定、文档索引（始终加载）
      {doc-name}.md        # 任务导向的查询模式文档（按需加载）
```

## 知识库三层架构

| 层级 | 来源 | 加载方式 | 内容 |
|---|---|---|---|
| 插件级 | 代码中硬编码 | 始终加载 | CQL/SQL 通用语法、使用技巧 |
| Topic 目录 | `knowledge/{topic}/_catalog.md` | 始终加载 | 字段定义、项目约定、文档索引 |
| 任务文档 | `knowledge/{topic}/{doc}.md` | 按需加载 | 详细查询模式、分析方法、排查手册 |

---

## Agent 指南：部署

本节面向负责部署插件的 Agent 或运维人员。

### 前置条件

- 知了 Agent 运行环境（Node.js + tsx）
- 腾讯云 API 凭证（SecretId / SecretKey），在 [CAM 控制台](https://console.cloud.tencent.com/cam/capi) 获取

### 安装步骤

```bash
# 1. 克隆到插件目录
cd agent/plugins/
git clone git@github.com:git-zhiliao/cls-query.git cls-query

# 2. 安装依赖
cd cls-query && npm install && cd ..

# 3. 配置
cp cls-query/config.example.yaml cls-query/config.yaml
# 编辑 config.yaml，填入真实凭证和 topic 信息
```

### 配置说明

编辑 `config.yaml`：

```yaml
# 凭证：通过环境变量注入（推荐）或直接填写
secret_id: "${TENCENTCLOUD_SECRET_ID}"
secret_key: "${TENCENTCLOUD_SECRET_KEY}"

default_region: "ap-nanjing"

# 注册已知 topic（仅需 topic_id 和 region）
known_topics:
  my_app:
    topic_id: "your-topic-id-here"
    region: "ap-nanjing"
```

环境变量通过 `export` 导出，或在 `docker-compose.yml` 的 `environment` 中配置。

### 验证

```bash
# 启动知了 Agent 后检查日志
docker compose logs agent | grep "Plugin loaded"
# 预期输出: Plugin loaded: cls-query (2 tools)

# 如有知识库，还会看到:
# Knowledge loaded for "my_app": catalog + N docs
```

### Docker 部署

插件目录通过 volume mount 进入容器：

```yaml
services:
  agent:
    volumes:
      - ./agent/plugins:/app/plugins
    environment:
      - TENCENTCLOUD_SECRET_ID=your-id
      - TENCENTCLOUD_SECRET_KEY=your-key
```

---

## Agent 指南：知识库维护

知识库目录 `knowledge/` 被 gitignore，独立于插件代码管理。可由外部 Agent 生成、独立仓库管理或手动维护。

完整编写指南（目录结构、文件格式、命名原则、内容分层规则）见 [`knowledge/CLAUDE.md`](knowledge/CLAUDE.md)。
