#!/bin/bash -e

cmd="run --allow-read --allow-write=src/gen-api.ts ./scripts/gen.ts"

if [ "$1" = "--no-docker" ]; then
    exec deno $cmd
fi

exec docker run --rm -e DENO_DIR=/home/deno/deno_dir -v "$(pwd)/deno_dir:/home/deno/deno_dir" -v "$(pwd):/home/deno/code" --workdir=/home/deno/code --user "${UID}" denoland/deno:ubuntu-1.34.3 $cmd