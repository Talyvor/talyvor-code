import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "http";
import { AddressInfo } from "net";
import { LensClient } from "./client";
import { issueSpendLabel } from "../track/cost-label-pure";

// The cost dashboard's issue spend, read from a stub Lens serving /v1/api/spend/by-request.

async function withLens(
  handler: (url: URL) => { status: number; body: unknown },
  body: (client: LensClient, seen: URL[]) => Promise<void>,
): Promise<void> {
  const seen: URL[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "", "http://lens");
    seen.push(url);
    const out = handler(url);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await body(new LensClient(`http://127.0.0.1:${port}`, "sk-test"), seen);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("the dashboard sums the active issue's by-request rows across every page", async () => {
  const pages: Record<string, unknown> = {
    "": {
      rows: [
        { issue_id: "ENG-42", cost_usd: 0.5, input_tokens: 100, output_tokens: 50 },
        { issue_id: "ENG-7", cost_usd: 9, input_tokens: 1, output_tokens: 1 },
        { issue_id: "", cost_usd: 9, input_tokens: 1, output_tokens: 1 },
      ],
      next_cursor: "c1",
    },
    c1: {
      rows: [{ issue_id: "ENG-42", cost_usd: 0.25, input_tokens: 10, output_tokens: 5 }],
      next_cursor: "",
    },
  };
  await withLens(
    (url) => ({ status: 200, body: pages[url.searchParams.get("cursor") ?? ""] }),
    async (client, seen) => {
      const spend = await client.getIssueSpend("ENG-42");
      assert.deepEqual(spend, {
        available: true,
        issueId: "ENG-42",
        totalCostUSD: 0.75,
        tokens: 165,
        requests: 2,
        days: 30,
      });
      assert.deepEqual(seen.map((u) => u.pathname), ["/v1/api/spend/by-request", "/v1/api/spend/by-request"]);
      assert.equal(seen[1].searchParams.get("cursor"), "c1");
      assert.equal(seen[0].searchParams.get("days"), "30");
      assert.deepEqual(issueSpendLabel(spend), {
        figure: "$0.75",
        note: "2 requests in the last 30 days, recorded by Lens",
      });
    },
  );
});

test("an error from Lens reads as not available, never $0.00", async () => {
  await withLens(
    () => ({ status: 500, body: { error: "boom" } }),
    async (client) => {
      const spend = await client.getIssueSpend("ENG-42");
      assert.equal(spend.available, false);
      const label = issueSpendLabel(spend);
      assert.equal(label.figure, "not available");
      assert.doesNotMatch(label.figure + label.note, /\$0\.00/);
    },
  );
});
