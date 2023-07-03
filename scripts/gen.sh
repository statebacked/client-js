#!/bin/sh -e

exec docker run --rm -p 3000:3000 -e DENO_DIR=/home/deno/deno_dir -v "$(pwd)/deno_dir:/home/deno/deno_dir" -v "$(pwd):/home/deno/code" --workdir=/home/deno/code --user "${UID}" denoland/deno:ubuntu-1.34.3 run --allow-read --allow-write=src/gen-api.ts ./scripts/gen.ts