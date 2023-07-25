import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";
import * as esbuild from "https://deno.land/x/esbuild@v0.17.19/mod.js";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.8.1/mod.ts";

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
      "esm/**/*.map",
      "script/**/*.js",
      "script/**/*.d.ts",
      "script/**/*.map",
      "browser/**/*.js",
      "browser/**/*.d.ts",
      "browser/**/*.map",
    ],
    type: "module",
    types: "./esm/mod.d.ts",
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
    "exports": {
      ".": {
        "types": {
          "import": "./esm/mod.d.ts",
          "require": "./script/mod.d.ts",
        },
        "browser": {
          "import": "./browser/esm.js",
          "require": "./browser/cjs.js",
        },
        "default": {
          "import": "./esm/mod.js",
          "require": "./script/mod.js",
        },
      },
    },
    homepage: "https://statebacked.dev",
    repository: {
      type: "git",
      url: "git+https://github.com/statebacked/client-js.git",
    },
    bugs: {
      url: "https://github.com/statebacked/client-js/issues",
    },
  },
  async postBuild() {
    // steps to run after building and before running the tests
    await Promise.all([
      Deno.copyFile("LICENSE", "npm/LICENSE"),
      Deno.copyFile("README.md", "npm/README.md"),
      esbuild.build({
        plugins: [...denoPlugins()],
        entryPoints: ["./mod.ts"],
        outfile: `npm/browser/esm.js`,
        bundle: true,
        sourcemap: "external",
        format: "esm",
      }),
      esbuild.build({
        plugins: [...denoPlugins()],
        entryPoints: ["./mod.ts"],
        outfile: `npm/browser/cjs.js`,
        bundle: true,
        sourcemap: "external",
        format: "cjs",
      }),
    ]);

    esbuild.stop();
  },
});
