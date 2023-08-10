import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { serve } from "https://deno.land/std@0.192.0/http/mod.ts";
import { LogEntry, LogsResponse, StateBackedClient } from "./index.ts";
import { defer } from "./defer.ts";

const port = 7004;

Deno.test("logs.watch", async () => {
  const instanceName = "inst";
  let logCount = 30;
  const startTs = Date.now();
  const logs = Array.from({ length: 30 }, (_, i): LogEntry => ({
    instanceName,
    machineName: "machine",
    machineVersionId: "version",
    orgId: "org",
    outputType: "stdout",
    timestamp: new Date(startTs + i).toISOString(),
    log: "log",
  }));
  const from = new Date();
  const abort = new AbortController();
  const [onListen, whenListening] = defer();

  const client = new StateBackedClient("token", {
    apiHost: `http://localhost:${port}`,
  });

  const server = serve((req) => {
    const url = new URL(req.url, "http://localhost");
    assertEquals(url.searchParams.get("instance"), instanceName);
    assertNotEquals(url.searchParams.get("from"), null);

    const logBatch = logs.splice(0, 10);
    const res: LogsResponse = {
      maxTimestamp: logBatch[logBatch.length - 1]?.timestamp ??
        url.searchParams.get("from"),
      logs: logBatch,
    };
    return new Response(JSON.stringify(res), { status: 200 });
  }, { port, signal: abort.signal, onListen });

  await whenListening;

  for await (
    const log of client.logs.watch(from, { instanceName }, abort.signal)
  ) {
    assertEquals(log.instanceName, instanceName);
    if (--logCount === 0) {
      abort.abort();
    }
  }

  assertEquals(logCount, 0);

  await server;
});
