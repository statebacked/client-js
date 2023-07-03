import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    undici: true,
  },
  test: false,
  skipSourceOutput: true,
  typeCheck: "both",
  package: {
    name: "@statebacked/client",
    version: Deno.args[0],
    description:
      "The API client for the StateBacked.dev XState backend as a service",
    license: "MIT",
    author: "Adam Berger <adam@statebacked.dev>",
    files: [
      "esm/**/*.js",
      "esm/**/*.d.ts",
      "script/**/*.js",
      "script/**/*.d.ts",
    ],
    keywords: [
      "statechart",
      "state machine",
      "scxml",
      "state",
      "finite state machine",
      "state backed",
      "backend as a service",
      "paas",
    ],
    homepage: "https://statebacked.dev",
    repository: {
      type: "git",
      url: "git+https://github.com/statebacked/client-js.git",
    },
    bugs: {
      url: "https://github.com/statebacked/client-js/issues",
    },
  },
  postBuild() {
    // steps to run after building and before running the tests
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
