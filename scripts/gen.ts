#!/bin/env deno

import openapi, { OpenAPI3 } from "npm:openapi-typescript@6.2.8";
import * as path from "https://deno.land/std@0.192.0/path/mod.ts";
import { parse as yamlParse } from "https://deno.land/std@0.82.0/encoding/yaml.ts";

const schema = yamlParse(
  new TextDecoder().decode(
    await Deno.readFile(path.join("api-spec", "statebacked.openapi.v3.yaml")),
  ),
) as OpenAPI3;

const out = await openapi(
  schema,
);

await Deno.writeFile(
  path.join("src", "gen-api.ts"),
  new TextEncoder().encode(out),
);
