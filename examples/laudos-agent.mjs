// Laudos.AI quick-laudo adapter for the LAIBench Pro command provider.
//
// Reads a GenerationInput JSON payload on stdin ({ exam, findings, locale })
// and emits { html, metadata } on stdout, calling the private Laudos.AI
// REST API (POST /api/v1/quick-laudo).
//
// Requires: LAUDOSAI_API_KEY environment variable (key needs the "ai" permission).
// Never hardcode keys in this file — it is committed to a public repository.

import { stdin, stdout, env, exit } from "node:process";

const ENDPOINT = env.LAUDOSAI_ENDPOINT ?? "https://copilot.laudos.ai/api/v1/quick-laudo";
const TIMEOUT_MS = Number(env.LAUDOSAI_TIMEOUT_MS ?? 120_000);
const MAX_ATTEMPTS = Number(env.LAUDOSAI_MAX_ATTEMPTS ?? 3);

const apiKey = env.LAUDOSAI_API_KEY;
if (!apiKey) {
  console.error("LAUDOSAI_API_KEY is not set");
  exit(1);
}

let input = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  input += chunk;
});
stdin.on("end", async () => {
  try {
    const payload = JSON.parse(input);
    const result = await generate(payload);
    stdout.write(JSON.stringify(result));
  } catch (error) {
    console.error(String(error?.stack ?? error));
    exit(1);
  }
});

async function generate(payload) {
  const body = JSON.stringify({
    exame: payload.exam,
    achados: payload.findings,
  });

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`quick-laudo HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const data = await response.json();
      const html = firstNonEmptyString(data.laudo, data.html, data.report, data.content);
      if (!html) throw new Error(`quick-laudo returned no report body: ${JSON.stringify(data).slice(0, 400)}`);

      return {
        html,
        metadata: {
          provider: "laudos.ai",
          endpoint: "quick-laudo",
          attempt,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      lastError = error;
      const retriable = isRetriable(error);
      if (!retriable || attempt === MAX_ATTEMPTS) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function isRetriable(error) {
  const message = String(error?.message ?? error);
  if (/HTTP 4(0[013]|29)/.test(message)) return /429/.test(message);
  if (/HTTP 4\d\d/.test(message)) return false;
  return true; // network errors, timeouts, 5xx
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
