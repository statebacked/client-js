import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient } from "./index.ts";
import { testServer } from "./server.test.ts";

const port = 7003;

Deno.test("headers", async () => {
  const expectedOrg = "org_hello123";
  const expectedAct = { sub: "act_hello123", email: "fake@statebacked.dev" };

  const [abort, server] = await testServer(port, [
    (req) => {
      assertEquals(
        new URL(req.url).pathname,
        "/machines",
      );
      assertEquals(req.headers.get("x-statebacked-org-id"), expectedOrg);
      assertEquals(
        JSON.parse(req.headers.get("x-statebacked-act")!),
        expectedAct,
      );

      return new Response(
        JSON.stringify({
          machines: [],
        }),
        { status: 200 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
    orgId: expectedOrg,
    actAs: expectedAct,
  });

  await client.machines.list();

  abort.abort();
  await server;
});
