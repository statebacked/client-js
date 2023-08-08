import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient } from "./index.ts";
import { testServer } from "./test-server.ts";

Deno.test("get instance", async () => {
  const port = 8686;
  const machineName = "machine";
  const instanceName = "instance";
  const expectedState = {
    s1: {
      s2: "s2-1",
      s3: "s3-1",
    },
  };
  const expectedPublicContext = {
    hello: "world",
  };

  const [abort, server] = await testServer(port, [
    (req) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${instanceName}`,
      );
      return new Response(
        JSON.stringify({
          state: expectedState,
          publicContext: expectedPublicContext,
        }),
        { status: 200 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  const result = await client.machineInstances.get(machineName, instanceName);
  assertEquals(result.state, expectedState);
  assertEquals(result.publicContext, expectedPublicContext);
  assertEquals(result.states, [
    "s1",
    "s1.s2",
    "s1.s3",
    "s1.s2.s2-1",
    "s1.s3.s3-1",
  ]);

  abort.abort();
  await server;
});

Deno.test("create instance", async () => {
  const port = 8686;
  const machineName = "machine";
  const instanceName = "instance";
  const expectedState = {
    s1: {
      s2: "s2-1",
      s3: "s3-1",
    },
  };
  const expectedPublicContext = {
    hello: "world",
  };

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(new URL(req.url).pathname, `/machines/${machineName}`);
      const body = await req.json();

      assertEquals(body, {
        slug: instanceName,
        context: { public: expectedPublicContext },
      });

      return new Response(
        JSON.stringify({
          state: expectedState,
          publicContext: expectedPublicContext,
        }),
        { status: 200 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  const result = await client.machineInstances.create(machineName, {
    slug: instanceName,
    context: { public: expectedPublicContext },
  });
  assertEquals(result.state, expectedState);
  assertEquals(result.publicContext, expectedPublicContext);
  assertEquals(result.states, [
    "s1",
    "s1.s2",
    "s1.s3",
    "s1.s2.s2-1",
    "s1.s3.s3-1",
  ]);

  abort.abort();
  await server;
});

Deno.test("get or create instance", async () => {
  const port = 8686;
  const machineName = "machine";
  const instanceName = "instance";
  const expectedState = {
    s1: {
      s2: "s2-1",
      s3: "s3-1",
    },
  };
  const expectedPublicContext = {
    hello: "world",
  };

  const matchers = [
    (req: Request) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${instanceName}`,
      );
      return new Response("", { status: 404 });
    },
    async (req: Request) => {
      assertEquals(new URL(req.url).pathname, `/machines/${machineName}`);
      const body = await req.json();

      assertEquals(body, {
        slug: instanceName,
        context: { public: expectedPublicContext },
      });

      return new Response(
        JSON.stringify({
          state: expectedState,
          publicContext: expectedPublicContext,
        }),
        { status: 200 },
      );
    },
  ];

  const [abort, server] = await testServer(port, matchers);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  const result = await client.machineInstances.getOrCreate(
    machineName,
    instanceName,
    { context: { public: expectedPublicContext } },
  );

  assertEquals(matchers.length, 0);
  assertEquals(result.state, expectedState);
  assertEquals(result.publicContext, expectedPublicContext);
  assertEquals(result.states, [
    "s1",
    "s1.s2",
    "s1.s3",
    "s1.s2.s2-1",
    "s1.s3.s3-1",
  ]);

  abort.abort();
  await server;
});

Deno.test("get or create instance with race", async () => {
  const port = 8686;
  const machineName = "machine";
  const instanceName = "instance";
  const expectedState = {
    s1: {
      s2: "s2-1",
      s3: "s3-1",
    },
  };
  const expectedPublicContext = {
    hello: "world",
  };

  const matchers = [
    (req: Request) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${instanceName}`,
      );
      return new Response("", { status: 404 });
    },
    async (req: Request) => {
      assertEquals(new URL(req.url).pathname, `/machines/${machineName}`);
      const body = await req.json();

      assertEquals(body, {
        slug: instanceName,
        context: { public: expectedPublicContext },
      });

      return new Response("", { status: 409 });
    },
    (req: Request) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${instanceName}`,
      );

      return new Response(
        JSON.stringify({
          state: expectedState,
          publicContext: expectedPublicContext,
        }),
        { status: 200 },
      );
    },
  ];

  const [abort, server] = await testServer(port, matchers);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  const result = await client.machineInstances.getOrCreate(
    machineName,
    instanceName,
    { context: { public: expectedPublicContext } },
  );

  assertEquals(matchers.length, 0);
  assertEquals(result.state, expectedState);
  assertEquals(result.publicContext, expectedPublicContext);
  assertEquals(result.states, [
    "s1",
    "s1.s2",
    "s1.s3",
    "s1.s2.s2-1",
    "s1.s3.s3-1",
  ]);

  abort.abort();
  await server;
});
