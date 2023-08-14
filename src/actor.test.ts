import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  StateBackedClient,
  StateValue,
  WSToClientMsg,
  WSToServerMsg,
} from "./index.ts";
import { testServer } from "./server.test.ts";
import { defer } from "./defer.ts";

const port = 7008;

type Events = { type: "next" } | { type: "reset" };
type Context = {
  hello: string;
};
type State = { foo?: "bar" | "baz"; bar?: "baz" };

Deno.test("actor", async () => {
  const token = "test-token";
  const machineName = "my-machine";
  const machineInstanceName = "my-machine-instance";
  const expectedStates: Array<
    {
      state: StateValue;
      done: boolean;
      tags: Array<string>;
      publicContext: Context;
    }
  > = [{
    state: { foo: "bar" },
    done: false,
    tags: ["hi"],
    publicContext: { "hello": "world" },
  }, {
    state: { bar: "baz" },
    done: true,
    tags: ["bye"],
    publicContext: { "hello": "world2" },
  }];
  const statesToSend = [...expectedStates];

  const [doUnsubscribe, unsubscribed] = defer();

  let send: () => void;

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(req.method, "GET");
      assertEquals(new URL(req.url).pathname, "/rt");

      const { socket, response } = await Deno.upgradeWebSocket(req);
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as WSToServerMsg;
        switch (msg.type) {
          case "subscribe-to-instance": {
            send = () => {
              const update: WSToClientMsg = {
                type: "instance-update",
                machineInstanceName: msg.machineInstanceName,
                machineName: msg.machineName,
                ...statesToSend.shift()!,
              };
              socket.send(JSON.stringify(update));
            };

            send();
            return;
          }
          case "unsubscribe-from-instance": {
            setTimeout(
              doUnsubscribe,
              10,
            );
            return;
          }
        }
      };
      return response;
    },
    (req) => {
      assertEquals(req.method, "POST");
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${machineInstanceName}/events`,
      );

      const state = expectedStates[0];
      setTimeout(send, 10);

      return new Response(
        JSON.stringify({
          ...state,
        }),
        {
          status: 200,
        },
      );
    },
  ]);

  const client = new StateBackedClient(token, {
    apiHost: `http://localhost:${port}`,
  });

  const actor = client.machineInstances.getActor<Events, State, Context>(
    machineName,
    machineInstanceName,
    undefined,
    abort.signal,
  );

  assert(typeof actor.getSnapshot() === "undefined");

  const unsubscribe = actor.subscribe((state) => {
    const expected = expectedStates.shift()!;
    assertEquals(state, actor.getSnapshot());
    assertEquals(actor.getSnapshot(), actor.getSnapshot());

    assert(
      state.value["foo"] ? state.matches("foo") : state.matches("bar.baz"),
    );
    assertEquals(state?.value, expected.state);
    assertEquals(state?.done, expected.done);
    assertEquals(state?.context, { public: expected.publicContext });

    if (expectedStates.length === 0) {
      unsubscribe();
    } else {
      actor.send({ type: "next" });
    }
  });

  await unsubscribed;

  abort.abort();
  await server;
});
