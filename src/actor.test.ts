import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  Actor,
  ActorState,
  Event,
  StateBackedClient,
  StateValue,
  WSToClientMsg,
  WSToServerMsg,
} from "./index.ts";
import { testServer } from "./server.test.ts";
import { defer } from "./defer.ts";
import { ActorRef } from "npm:xstate@4.38.2";

// this is just to test that our actor type conforms to the xstate notion of an actor ref
function _testActorness<
  TEvent extends Exclude<Event, string> = any,
  TState extends StateValue = any,
  TContext extends Record<string, unknown> = any,
>(actor: Actor<TEvent, TState, TContext>) {
  const _actorRef: ActorRef<TEvent, ActorState<TState, TContext>> = actor;
}

const port = 7008;

type Events = { type: "next" } | { type: "reset" };
type Context = {
  hello: string;
};
type State = { foo?: "bar" | "baz"; bar?: "baz" };

Deno.test("getActor", async () => {
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
    (req) => {
      assertEquals(req.method, "GET");
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${machineInstanceName}`,
      );

      return new Response(
        JSON.stringify(statesToSend[0]),
        { status: 200 },
      );
    },
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

  const actor = await client.machineInstances.getActor<Events, State, Context>(
    machineName,
    machineInstanceName,
    abort.signal,
  );

  assertEquals(actor.getSnapshot(), actor.getSnapshot());
  assertEquals(actor.getSnapshot()?.context, {
    public: expectedStates[0].publicContext,
  });
  assertEquals(actor.getSnapshot()?.done, expectedStates[0].done);
  assertEquals(actor.getSnapshot()?.value, expectedStates[0].state);
  assertEquals(actor.getSnapshot()?.tags, new Set(expectedStates[0].tags));

  const subscription = actor.subscribe((state) => {
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
      subscription.unsubscribe();
    } else {
      actor.send({ type: "next" });
    }
  });

  await unsubscribed;

  assertEquals(expectedStates.length, 0);

  abort.abort();
  await server;
});

Deno.test("getOrCreateActor", async () => {
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
    (req) => {
      assertEquals(req.method, "GET");
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${machineInstanceName}`,
      );

      return new Response(
        null,
        { status: 404 },
      );
    },
    async (req) => {
      assertEquals(new URL(req.url).pathname, `/machines/${machineName}`);
      const body = await req.json();

      assertEquals(body, {
        slug: machineInstanceName,
        context: { public: statesToSend[0].publicContext },
      });

      return new Response(
        JSON.stringify({
          ...statesToSend[0],
        }),
        { status: 200 },
      );
    },
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

  const actor = await client.machineInstances.getOrCreateActor<
    Events,
    State,
    Context
  >(
    machineName,
    machineInstanceName,
    {
      context: { public: expectedStates[0].publicContext },
    },
    abort.signal,
  );

  assertEquals(actor.getSnapshot(), actor.getSnapshot());
  assertEquals(actor.getSnapshot()?.context, {
    public: expectedStates[0].publicContext,
  });
  assertEquals(actor.getSnapshot()?.done, expectedStates[0].done);
  assertEquals(actor.getSnapshot()?.value, expectedStates[0].state);
  assertEquals(actor.getSnapshot()?.tags, new Set(expectedStates[0].tags));

  const subscription = actor.subscribe({
    next: (state) => {
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
        subscription.unsubscribe();
      } else {
        actor.send({ type: "next" });
      }
    },
  });

  await unsubscribed;

  assertEquals(expectedStates.length, 0);

  abort.abort();
  await server;
});
