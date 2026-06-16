/**
 * TarotStage - 塔罗牌阶段
 *
 * 将 ai-tarot-oracle 的静态文件嵌入至 /tarot/index.html（放在 public/tarot/）。
 * DeepSeek API 由 vite.config.ts 的 tarotApiPlugin 在同端口拦截，无需额外服务器。
 *
 * 使用前准备：
 *   1. 将 ai-tarot-oracle 项目的 index.html 复制到 public/tarot/index.html
 *   2. 将 assets/ 目录复制到 public/tarot/assets/
 *   3. 将 tarot-card-back.jpg 复制到 public/tarot/tarot-card-back.jpg
 *   4. 在 public/tarot/index.html 中把 proxyURL 改为 '/api/tarot-reading'
 *   5. 在 .env 中配置 DEEPSEEK_API_KEY=sk-...
 *
 * 点击右上角 ✕ 或等待 5 分钟无操作后自动回到 STANDBY。
 */

import { useAppStore } from '../../store/useAppStore';

export function TarotStage() {
  const resetSession = useAppStore((s) => s.resetSession);

  return (
    <div className="stage stage-tarot">
      <button
        className="stage-tarot__close"
        type="button"
        onClick={resetSession}
        aria-label="退出塔罗，返回主界面"
      >
        ✕
      </button>

      <iframe
        className="stage-tarot__frame"
        src="/tarot/index.html"
        title="AI 塔罗星阵"
        allow="camera; microphone"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
