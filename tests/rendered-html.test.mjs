import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the DCF valuation tool", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /DCF Lab/);
  assert.match(html, /Interactive DCF Valuation Tool/i);
  assert.match(html, /Autofill Basic Data/);
  assert.match(html, /Calculate valuation/);
  assert.match(html, /Intrinsic value per share/);
  assert.match(html, /Five-year forecast/);
  assert.match(html, /Important limitations/);
  assert.equal((html.match(/step="any"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /Future Value/);
});
