import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { serve } from "https://deno.land/std@0.192.0/http/mod.ts";
import {
  StateBackedClient,
  StateValue,
  WSToClientMsg,
  WSToServerMsg,
} from "./index.ts";
import { defer } from "./defer.ts";

const port = 7006;

Deno.test("receive subscription items", async () => {
  const token = "test-token";
  const machineName = "my-machine";
  const machineInstanceName = "my-machine-instance";
  const expectedStates: Array<StateValue> = [{ foo: "bar" }, { bar: "foo" }];
  const abort = new AbortController();

  const [onListen, whenListening] = defer();

  const server = serve(async (req) => {
    const { socket, response } = await Deno.upgradeWebSocket(req);
    const statesToSend = expectedStates.slice();
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSToServerMsg;
      switch (msg.type) {
        case "subscribe-to-instance": {
          const stateUpdate1: WSToClientMsg = {
            type: "instance-update",
            machineInstanceName: msg.machineInstanceName,
            machineName: msg.machineName,
            publicContext: { token },
            state: statesToSend.shift()!,
            done: false,
            tags: ["hello"],
          };
          socket.send(JSON.stringify(stateUpdate1));

          const stateUpdate2: WSToClientMsg = {
            ...stateUpdate1,
            state: statesToSend.shift()!,
          };
          socket.send(JSON.stringify(stateUpdate2));
          return;
        }
        case "unsubscribe-from-instance": {
          abort.abort();
          return;
        }
      }
    };
    return response;
  }, { port, signal: abort.signal, onListen });

  await whenListening;

  const client = new StateBackedClient(token, {
    apiHost: `http://localhost:${port}`,
  });
  const unsubscribe = client.machineInstances.subscribe(
    machineName,
    machineInstanceName,
    (stateUpdate) => {
      assertEquals(stateUpdate.publicContext, { token });
      assertEquals(stateUpdate.state, expectedStates.shift());
      assertEquals(stateUpdate.tags, ["hello"]);
      assertEquals(stateUpdate.done, false);

      if (expectedStates.length === 0) {
        unsubscribe();
      }
    },
  );

  await server;
});

Deno.test("send pings", async () => {
  const token = "test-token";
  const pingTimeout = 100;
  const failureTimeout = pingTimeout + 100;
  const abort = new AbortController();

  const [onListen, whenListening] = defer();
  const [onPing, whenPinged] = defer();

  const failureTimer = setTimeout(() => {
    fail("did not receive ping");
  }, failureTimeout);

  const server = serve(async (req) => {
    const { socket, response } = await Deno.upgradeWebSocket(req);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSToServerMsg;
      switch (msg.type) {
        case "ping": {
          onPing();
          clearTimeout(failureTimer);
          return;
        }
        case "unsubscribe-from-instance": {
          abort.abort();
          return;
        }
      }
    };
    return response;
  }, { port, signal: abort.signal, onListen });

  await whenListening;

  const client = new StateBackedClient(token, {
    apiHost: `http://localhost:${port}`,
    wsPingIntervalMs: pingTimeout,
  });
  const unsubscribe = client.machineInstances.subscribe(
    "machine-name",
    "inst-name",
    () => {},
  );

  await whenPinged;

  unsubscribe();

  await server;
});

Deno.test("reconnect", async () => {
  const token = "test-token";
  const abort = new AbortController();

  const [onListen, whenListening] = defer();
  const [onConnect1, whenConnect1] = defer();
  const [onConnect2, whenConnect2] = defer();
  const [onFinalSubscribe, whenSubscribed] = defer();

  const onConnects = [onConnect1, onConnect2];

  const server = serve(async (req) => {
    const { socket, response } = await Deno.upgradeWebSocket(req);
    socket.onopen = () => {
      onConnects.shift()?.();
    };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSToServerMsg;
      switch (msg.type) {
        case "subscribe-to-instance": {
          if (onConnects.length > 0) {
            socket.close();
          } else {
            onFinalSubscribe();
          }
          return;
        }
        case "unsubscribe-from-instance": {
          abort.abort();
          return;
        }
      }
    };
    return response;
  }, { port, signal: abort.signal, onListen });

  await whenListening;

  const client = new StateBackedClient(token, {
    apiHost: `http://localhost:${port}`,
  });
  const unsubscribe = client.machineInstances.subscribe(
    "machine-name",
    "inst-name",
    () => {},
  );

  await whenConnect1;
  // ensure we reconnect
  await whenConnect2;
  // and ensure we resubscribe when we reconnect
  await whenSubscribed;

  unsubscribe();

  await server;
});
