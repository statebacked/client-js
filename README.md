# StateBacked.dev client for web, Node, and Deno

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/statebacked/client-js/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/@statebacked/client.svg?style=flat)](https://www.npmjs.com/package/@statebacked/client) [![CI](https://github.com/statebacked/client-js/actions/workflows/ci.yaml/badge.svg)](https://github.com/statebacked/client-js/actions/workflows/ci.yaml) [![Docs](https://img.shields.io/badge/docs-statebacked-blue)](https://docs.statebacked.dev/) [![API Docs](https://img.shields.io/badge/docs-api-blue)](https://statebacked.github.io/client-js)

Deploy invincible workflows and real-time, multiplayer backends with [StateBacked.dev](https://statebacked.dev).

Check out the full State Backed [docs](https://docs.statebacked.dev) for more detailed information and deploy your own state machine backend in just a few minutes.

This is the client library for interacting with the State Backed API. You can find the API docs for the State Backed client [here](https://statebacked.github.io/client-js).

The StateBacked.dev client provides an easy interface to interact with the State Backed API 
to create machines and machine versions, create machine instances, read the state of instances,
and send events to instances.

Generally, you will want to use the [web dashboard](https://www.statebacked.dev) or [smply](https://github.com/statebacked/smply), the State Backed CLI
for administrative operations like creating machines and machine versions (`smply machines create` and `smply machine-versions create`) and use the API client for production
operations like creating machine instances, subscribing to real-time state updates, and
sending events.

Use the [@statebacked/react](https://github.com/statebacked/react) package to connect to your
machine instances from React.

# Example

```js
import { StateBackedClient } from "@statebacked/client";

const sessionId = crypto.randomUUID();

// you can create anonymous State Backed sessions or fully authenticated
// sessions to securely pass end-user claims to your machine authorizers
const client = new StateBackedClient({
  anonymous: {
    orgId: "org-YOUR_STATE_BACKED_ORG_ID",
    getSessionId() {
      return sessionId;
    }
  }
});

// we can send an event to the `user-onboarding` machine instance
// for our current sesion and use the updated machine state and any
// public context. The event will only be accepted if your
// allowWrite machine authorizer allows the request with the given authorization
// claims (in this case of anonymous access, just a session ID) to
// send this event to this machine instance.

const { state, publicContext } = await client.machineInstances.sendEvent(
  "user-onboarding", // machine name
  sessionId, // machine instance name
  {
    event: {
      type: "completed-tutorial",
      role: "engineer",
      preferredChannel: "email",
    }
  }
);

// we can also subscribe to state updates for any machine instance
// as long as your allowRead machine authorizer allows the request with
// our authorization claims to read its state

const unsubscribe = client.machineInstances.subscribe(
  "user-onboarding", // machine name
  sessionId, // machine instance name
  ({ state, publicContext, tags, done }) => {
    // react to new state
  }
);

// when you're done:
unsubscribe();

```
