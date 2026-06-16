import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 简单的 .env 文件解析器
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  return env;
}

/**
 * Vite 服务端插件：拦截 /api/tarot-reading，转发至 Gemini / ZHIPU / DeepSeek API。
 * 需要在 .env 中配置对应 API Key（GEMINI_API_KEY / ZHIPU_API_KEY / DEEPSEEK_API_KEY）。
 * 替代 ai-tarot-oracle 的独立 server.js，无需额外端口。
 */
function tarotApiPlugin(): Plugin {
  let envVars: Record<string, string> = {};
  type ProviderName = 'gemini' | 'silicon' | 'nvidia' | 'deepseek' | 'zhipu';
  return {
    name: 'tarot-api',
    configureServer(server: ViteDevServer) {
      // 在服务器启动时加载 .env 文件
      const envPath = path.resolve(process.cwd(), '.env');
      envVars = parseEnvFile(envPath);
      
      server.middlewares.use('/api/tarot-reading', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        let provider = 'deepseek'; // 定义在外层作用域，catch 块可以访问
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { question = '', cards = [], provider: requestProvider = 'deepseek', model } = JSON.parse(body) as {
              question?: string;
              cards?: Array<{ name: string; isReversed: boolean }>;
              provider?: ProviderName;
              model?: string;
            };
            provider = requestProvider; // 更新外层变量

            const cardsStr = cards
              .map((c) => (c.isReversed ? `${c.name}（逆位）` : c.name))
              .join('、');

            const systemPrompt = `你不是在解释塔罗牌义，你正在为一个真实的人进行占卜。
你的身份是一位经验丰富、直觉极强的塔罗师：
- 你相信牌不是随机的，而是回应提问者的潜意识
- 你会优先说出"最重要、最刺痛、最被回避的那一点"
- 你允许使用直觉判断，而不是完全依赖教科书牌义
占卜风格：语言要有温度，像在低声对话。不要按教科书结构，可以停顿、反问、直指情绪。少总结，多揭示。控制在400字以内，完整收尾。`;

            const userPrompt = `我现在的问题是：「${question || '无声的困惑'}」。
我抽到的三张牌（按时间顺序）是：${cardsStr}
请像真正的塔罗师一样，先静静感受这组牌的整体气息，然后给出你的解读。`;

            let usedProvider: ProviderName | '' = '';
            const providerKeys: Record<ProviderName, string> = {
              gemini: envVars.GEMINI_API_KEY || '',
              silicon: envVars.SILICON_API_KEY || '',
              nvidia: envVars.NVIDIA_API_KEY || '',
              deepseek: envVars.DEEPSEEK_API_KEY || '',
              zhipu: envVars.ZHIPU_API_KEY || '',
            };

            const fallbackOrder: ProviderName[] = ['gemini', 'silicon', 'nvidia', 'deepseek', 'zhipu'];
            const preferred = (provider as ProviderName);
            const tryOrder = [preferred, ...fallbackOrder.filter((p) => p !== preferred)]
              .filter((p, idx, arr) => arr.indexOf(p) === idx)
              .filter((p) => Boolean(providerKeys[p]));

            if (tryOrder.length === 0) {
              throw new Error('No usable provider key found in .env');
            }

            const parseUpstreamError = async (upstream: Response, label: string): Promise<string> => {
              const errData = await upstream.json().catch(() => ({})) as {
                error?: { message?: string } | string;
                message?: string;
              };
              const msg = typeof errData.error === 'string'
                ? errData.error
                : errData.error?.message || errData.message || `${label} returned ${upstream.status}`;
              return `${label} returned ${upstream.status}: ${msg}`;
            };

            const callProvider = async (candidate: ProviderName): Promise<{ choices: Array<{ message: { content: string } }> }> => {
              const apiKey = providerKeys[candidate];
              if (!apiKey) {
                throw new Error(`${candidate} key not configured`);
              }

              if (candidate === 'gemini') {
                const geminiModel = (model && preferred === 'gemini') ? model : 'gemini-2.5-flash';
                const encodedModel = geminiModel.includes('gemini') ? geminiModel : `gemini-${geminiModel}`;
                let upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${apiKey}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
                    generationConfig: { temperature: 0.8, maxOutputTokens: 4096 }
                  }),
                });

                if (upstream.status === 503) {
                  await new Promise((r) => setTimeout(r, 1800));
                  upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
                      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 }
                    }),
                  });
                }

                if (!upstream.ok) {
                  throw new Error(await parseUpstreamError(upstream, 'Gemini'));
                }

                const geminiResp = await upstream.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
                const geminiText = geminiResp.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return { choices: [{ message: { content: geminiText } }] };
              }

              if (candidate === 'silicon') {
                const siliconModel = (model && preferred === 'silicon') ? model : 'Qwen/Qwen2.5-72B-Instruct';
                const upstream = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    model: siliconModel,
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: userPrompt },
                    ],
                    temperature: 0.8,
                    max_tokens: 2000,
                  }),
                });

                if (!upstream.ok) {
                  throw new Error(await parseUpstreamError(upstream, 'Silicon'));
                }
                return await upstream.json() as { choices: Array<{ message: { content: string } }> };
              }

              if (candidate === 'nvidia') {
                const nvidiaModel = (model && preferred === 'nvidia') ? model : 'meta/llama-3.1-70b-instruct';
                const upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    model: nvidiaModel,
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: userPrompt },
                    ],
                    temperature: 0.8,
                    max_tokens: 2000,
                  }),
                });

                if (!upstream.ok) {
                  throw new Error(await parseUpstreamError(upstream, 'NVIDIA'));
                }
                return await upstream.json() as { choices: Array<{ message: { content: string } }> };
              }

              if (candidate === 'zhipu') {
                const [zhipuId, zhipuSecret] = apiKey.split('.');
                if (!zhipuId || !zhipuSecret) throw new Error('ZHIPU_API_KEY format should be id.secret');

                const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
                const now = Math.floor(Date.now() / 1000);
                const payload = Buffer.from(JSON.stringify({ api_key: zhipuId, exp: now + 3600, timestamp: now })).toString('base64url');
                const sigData = `${header}.${payload}`;
                const { createHmac } = await import('node:crypto');
                const sig = createHmac('sha256', zhipuSecret).update(sigData).digest('base64url');
                const zhipuToken = `${sigData}.${sig}`;

                const zhipuModel = (model && preferred === 'zhipu') ? model : 'glm-4-flash';
                const upstream = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${zhipuToken}`,
                  },
                  body: JSON.stringify({
                    model: zhipuModel,
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: userPrompt },
                    ],
                    temperature: 0.8,
                    max_tokens: 2000,
                  }),
                });

                if (!upstream.ok) {
                  throw new Error(await parseUpstreamError(upstream, 'ZHIPU'));
                }
                return await upstream.json() as { choices: Array<{ message: { content: string } }> };
              }

              const deepseekModel = (model && preferred === 'deepseek') ? model : 'deepseek-chat';
              const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: deepseekModel,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                  ],
                  temperature: 0.8,
                  max_tokens: 2000,
                }),
              });

              if (!upstream.ok) {
                throw new Error(await parseUpstreamError(upstream, 'DeepSeek'));
              }
              return await upstream.json() as { choices: Array<{ message: { content: string } }> };
            };

            const providerErrors: string[] = [];
            let responseData: { choices: Array<{ message: { content: string } }> } | null = null;

            for (const candidate of tryOrder) {
              try {
                responseData = await callProvider(candidate);
                usedProvider = candidate;
                break;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                providerErrors.push(`${candidate}: ${msg}`);
              }
            }

            if (!responseData) {
              throw new Error(`All providers failed: ${providerErrors.join(' | ')}`);
            }

            const data = responseData;

            // 清除 markdown 符号（与原 server.js 一致）
            let content = data.choices[0]?.message?.content ?? '';
            content = content
              .replace(/^#{1,6}\s+/gm, '')
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\*([^*]+)\*/g, '$1')
              .replace(/^\s*-\s+/gm, '• ')
              .trim();
            data.choices[0].message.content = content;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            if (usedProvider) {
              res.setHeader('X-Tarot-Provider', usedProvider);
            }
            res.end(JSON.stringify(data));
          } catch (err) {
            const message = err instanceof Error ? err.message : '服务器内部错误';
            console.error(`[Tarot API Error (${provider})]`, message, err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: message, provider, details: err instanceof Error ? err.stack : String(err) }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tarotApiPlugin()],
  // mind-ar 体积大且内部含动态加载 / worker 逻辑，预构建会失败，按原样以 ESM 提供
  optimizeDeps: {
    exclude: ['mind-ar'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/google-tts': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google-tts/, '/translate_tts'),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['set-cookie'];
            delete proxyRes.headers['Set-Cookie'];
          });
        },
        headers: {
          'Referer': 'https://translate.google.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      }
    }
  }
})
