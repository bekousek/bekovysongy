#!/bin/sh
# run.sh <slug>... - reformat each song from .fmt-specs/<slug>.json and check
# that only the layout moved. The file is restored from HEAD first, so a spec
# is always applied to the original text and re-running is safe.
set -e
for slug in "$@"; do
  git checkout HEAD -- "songs/$slug.html"
  node tools/fmt.cjs apply "$slug" ".fmt-specs/$slug.json"
  node tools/verify.cjs "$slug"
done
