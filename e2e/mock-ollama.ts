import http from "http";
import type { AddressInfo } from "net";

export interface MockOllama {
  port: number;
  /** 收到的 /api/generate 请求体（便于断言 prompt 内容） */
  generateRequests: unknown[];
  /** 所有收到的请求（方法 + 路径 + 时间戳），用于调试 */
  requests: { method: string; url: string; at: number }[];
  close: () => Promise<void>;
}

export interface MockOllamaOptions {
  /** 续写时流式返回的文本（按字符逐个 token 发送） */
  completionText?: string;
  /** embedding 维度（需与应用配置一致，默认 1024） */
  dimensions?: number;
}

/**
 * 本机 mock Ollama 服务：实现 /api/tags、/api/embed、/api/generate。
 * 应用默认模型与默认 embedding 配置均指向 http://localhost:11434，
 * 因此无需修改应用配置即可跑通完整 AI 链路。
 */
export async function startMockOllama(
  port: number,
  options: MockOllamaOptions = {}
): Promise<MockOllama> {
  const completionText =
    options.completionText ??
    "夜色渐深，小镇的灯火一盏接一盏熄灭。他站在桥头，望着河面上破碎的月光，终于下定了决心。明天一早，他就动身去北境。";
  const dimensions = options.dimensions ?? 1024;

  const generateRequests: unknown[] = [];

  const embedding = Array.from({ length: dimensions }, (_, i) => Math.sin(i) * 0.01);

  const requests: { method: string; url: string; at: number }[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    requests.push({ method: req.method ?? "?", url, at: Date.now() });

    if (req.method === "GET" && url.startsWith("/api/tags")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5" }, { name: "bge-m3" }] }));
      return;
    }

    if (req.method === "POST" && url.startsWith("/api/embed")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let count = 1;
        try {
          const parsed = JSON.parse(body);
          count = Array.isArray(parsed.input) ? parsed.input.length : 1;
        } catch {
          /* ignore */
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ embeddings: Array.from({ length: count }, () => embedding) }));
      });
      return;
    }

    if (req.method === "POST" && url.startsWith("/api/generate")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          generateRequests.push(JSON.parse(body));
        } catch {
          /* ignore */
        }
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        // 按字符流式发送 NDJSON
        for (const ch of completionText) {
          res.write(JSON.stringify({ response: ch, done: false }) + "\n");
          await new Promise((r) => setTimeout(r, 5));
        }
        res.write(
          JSON.stringify({
            response: "",
            done: true,
            prompt_eval_count: 120,
            eval_count: completionText.length,
          }) + "\n"
        );
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const actualPort = (server.address() as AddressInfo).port;
  return {
    port: actualPort,
    generateRequests,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
