# 塔罗占卜 LLM API 配置指南

## 快速开始

编辑 `.env` 文件，配置至少一个 API Key：

```bash
# DeepSeek（推荐，国内快速）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# 或 Google Gemini
GEMINI_API_KEY=AIzaSyDxxxxxxxxxxxx

# 或 ZHIPU（智谱清言）
ZHIPU_API_KEY=xxxxxxxxxxxx
```

## 支持的 API 供商

### 1. **DeepSeek**（默认）
- **优点**：国内API延迟低，价格低廉
- **模型**：`deepseek-chat`（推荐）、`deepseek-reasoner`
- **获取地址**：https://platform.deepseek.com
- **配置**：设置 `DEEPSEEK_API_KEY`

### 2. **Google Gemini**
- **优点**：多模态、长文本支持
- **模型**：`gemini-1.5-pro`（推荐）、`gemini-1.5-flash`、`gemini-pro`
- **获取地址**：https://aistudio.google.com/app/apikey
- **配置**：设置 `GEMINI_API_KEY`

### 3. **ZHIPU（智谱清言）**
- **优点**：国内LLM厂商，支持多种模型
- **模型**：`glm-4`（推荐）、`glm-3.5-turbo`
- **获取地址**：https://open.bigmodel.cn/usercenter/apikeys
- **配置**：设置 `ZHIPU_API_KEY`

## 配置方式

### 方法 1：通过前端配置（推荐）

编辑 `public/tarot/index.html`，修改 `LLM_CONFIG` 对象：

```javascript
const LLM_CONFIG = {
    useProxy: true,        // 始终为 true（后端代理）
    proxyURL: '/api/tarot-reading',
    provider: 'deepseek',  // 改成 'gemini' 或 'zhipu'
    model: '',             // 留空使用默认值，或指定具体模型
};
```

**支持的 provider 值**：
- `'deepseek'` → 使用 DeepSeek API（默认模型：`deepseek-chat`）
- `'gemini'` → 使用 Google Gemini（默认模型：`gemini-1.5-pro`）
- `'zhipu'` → 使用 ZHIPU GLM（默认模型：`glm-4`）

### 方法 2：通过 API 请求头传递

前端发送占卜请求时，在请求体中指定 provider：

```javascript
fetch('/api/tarot-reading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        question: '我的问题是...',
        cards: [...],
        provider: 'gemini',  // 动态切换供商
        model: 'gemini-1.5-pro'
    })
})
```

## 多 API 支持原理

### 后端代理流程（vite.config.ts）

1. **请求拦截**：`/api/tarot-reading` POST 请求
2. **供商识别**：读取请求体中的 `provider` 字段
3. **认证**：根据 provider 从 `.env` 读取对应 API Key
4. **转发**：构造标准化的 system prompt + user prompt，转发至对应 API
5. **响应处理**：
   - **DeepSeek & ZHIPU**：标准 OpenAI 格式响应
   - **Gemini**：Google 原生格式 → 转换为 OpenAI 兼容格式
6. **清理**：移除 markdown 符号，返回纯文本

### 前端调用流程（public/tarot/index.html）

1. **配置加载**：从 `LLM_CONFIG` 读取 provider 和 model
2. **请求准备**：包装问题 + 抽取卡牌信息 + provider + model
3. **后端通信**：POST 至 `/api/tarot-reading`
4. **结果处理**：解析响应中的占卜解读内容

## 故障排查

### 问题：`Please set XXXX_API_KEY in .env`

**原因**：未配置对应供商的 API Key  
**解决**：
1. 确保 `.env` 文件存在于项目根目录
2. 填入正确的 API Key（不要遗漏前缀如 `sk-`, `AIzaSy-` 等）
3. 重启开发服务器（`npm run dev`）

### 问题：占卜请求超时或返回错误

**原因**：
- 网络连接问题（特别是 Gemini/ZHIPU 如在国内）
- API Key 已过期或额度用尽
- 供商 API 服务中断

**解决**：
1. 检查 `console` 中的详细错误信息
2. 验证 API Key 的有效性和剩余额度
3. 切换到另一个已配置的 API 供商
4. 查看对应供商的 API 状态页面

### 问题：某个 provider 总是失败

**原因**：API 端点格式错误、模型名称不匹配

**解决**：
1. 检查 `.env` 中的 API Key 格式
2. 验证前端 `LLM_CONFIG.model` 是否为该 provider 支持的模型
3. 查看浏览器开发者工具 → Network 标签，检查实际请求内容

## 开发建议

### 本地测试多个 API

```javascript
// 在浏览器 console 测试
fetch('/api/tarot-reading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        question: '这是测试问题',
        cards: [
            { name: '愚者', isReversed: false },
            { name: '魔术师', isReversed: true },
            { name: '女祭司', isReversed: false }
        ],
        provider: 'gemini'  // 或 'zhipu' / 'deepseek'
    })
}).then(r => r.json()).then(console.log)
```

### 性能对比

| 供商 | 响应速度 | 费用 | 稳定性 | 适用场景 |
|------|--------|------|--------|---------|
| **DeepSeek** | 🟢 快（国内） | 🟢 低 | 🟡 中 | 💡 成本优先 |
| **Gemini** | 🟡 中（需代理） | 🟠 中 | 🟢 高 | 💡 质量优先 |
| **ZHIPU** | 🟢 快（国内） | 🟠 中 | 🟢 高 | 💡 均衡选择 |

## 环境变量完整参考

```bash
# .env 文件模板

# ===== API Keys =====
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaSyDxxxxxxxxxxxxxxxxxxxxx
ZHIPU_API_KEY=xxxxxxxxxxxxxxxxxxxxx

# ===== 可选：默认供商 =====
# LLM_PROVIDER=deepseek  # 不设置时由前端 LLM_CONFIG.provider 决定
```

## 常见问题 (FAQ)

**Q: 如何在运行时切换 API 供商？**  
A: 修改 `public/tarot/index.html` 中的 `LLM_CONFIG.provider`，或在占卜请求中动态指定。

**Q: 支持多个 API Key 同时配置吗？**  
A: 支持！可同时配置三个，前端选择要使用的 provider。

**Q: API Key 会泄露吗？**  
A: 不会。所有 API 调用都通过后端代理，前端不直接接触 API Key。

**Q: 哪个 API 最便宜？**  
A: DeepSeek 通常最便宜（¥0.14/百万 tokens input）。

---

**最后更新**：2024-06  
**配置完成后**：运行 `npm run dev` 启动开发服务器，访问 http://localhost:5173
