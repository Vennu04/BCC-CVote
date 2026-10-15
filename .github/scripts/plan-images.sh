#!/bin/bash
# Works out which images need building: compares this commit with the commit
# whose image prod is running now (the :<sha8> tag sharing latest's digest).
set -euo pipefail
include='[]'; images=''
for IMG in backend frontend; do
  REPO="bcc-cvote-$IMG"
  digest() { aws ecr batch-get-image --repository-name "$REPO" --image-ids imageTag="$1" \
    --query 'images[0].imageId.imageDigest' --output text 2>/dev/null || echo None; }
  LATEST=$(digest latest)
  BASE=""
  if [ "$LATEST" != "None" ]; then
    for C in $(git rev-list --first-parent --max-count=40 HEAD 2>/dev/null); do
      if [ "$(digest "${C::8}")" = "$LATEST" ]; then BASE=$C; break; fi
    done
  fi
  if [ -z "$BASE" ]; then build=true; reason="can't tell which commit prod runs"
  elif git diff --quiet "$BASE" HEAD -- "$IMG/"; then build=false; reason="no $IMG/ changes since prod's ${BASE::8}"
  else build=true; reason="$IMG/ changed since prod's ${BASE::8}"; fi
  echo "$IMG: build=$build — $reason"
  if [ "$build" = true ]; then
    include=$(echo "$include" | jq -c --arg i "$IMG" --arg r "$REPO" '. + [{image: $i, repo: $r}]')
    images="$images $IMG"
  fi
done
echo "matrix={\"include\":$include}" >> "$GITHUB_OUTPUT"
echo "images=${images# }" >> "$GITHUB_OUTPUT"
