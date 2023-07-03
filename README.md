# StateBacked.dev client for web, Node, and Deno

[StateBacked.dev](https://statebacked.dev) runs XState machines as your secure, scalable, serverless backend.

Check out the full State Backed [docs](https://docs.statebacked.dev) for more detailed information and to
get started with your own XState backend as a service.

The StateBacked.dev client provides an easy interface to interact with the State Backed API 
to create machines and machine versions, create machine instances, read the state of instances,
and send events to instances.

Generally, you will want to use [smply](https://github.com/statebacked/smply), the State Backed CLI
to create machines and machine versions (`smply machines create` and `smply machine-versions create`)
and to generate API keys (`smply keys create`).

Then, you'll use [@statebacked/token](https://github.com/statebacked/token) to create a JWT for your
users using your API key.

Finally, in your frontend or backend, you can create machine instances, read instance state, and
send events to your instances.

# Example

```
import { StateBackedClient } from "@statebacked/client";

const jwtFromBackend = "..."; // create a JWT with @statebacked/token
const userId = "..."; // current user's id

const client = new StateBackedClient(jwtFromBackend);

// we can send an event to the `user-onboarding` machine instance
// for our current user and then respond to the new machine state
// and any public context. The event will only be accepted if your
// authorization logic allows the user with the given jwt to access
// this machine instance.

const { state, publicContext } = await client.machineInstances.sendEvent(
    "user-onboarding",
    userId,
    {
        event: {
            type: "completed-tutorial",
            role: "engineer",
            preferredChannel: "email",
        }
    }
);

```
