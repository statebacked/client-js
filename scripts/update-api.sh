#!/bin/sh -e

git submodule init
git submodule foreach git pull
