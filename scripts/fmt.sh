#!/bin/sh -e

exec docker run --rm -e DENO_DIR=/home/deno/deno_dir -v "$(pwd)/deno_dir:/home/deno/deno_dir" -v "$(pwd):/home/deno/code" --workdir=/home/deno/code --user "${UID}" denoland/deno:ubuntu-1.34.3 fmt src/*.ts scripts/*.ts