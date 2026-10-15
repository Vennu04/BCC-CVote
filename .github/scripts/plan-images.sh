#!/bin/bash
# Decides, per image, what this deploy has to do. Each image is fingerprinted
# by the git tree hash of its folder (backend/ or frontend/) — the exact
# source it is built from — and tagged tree-<hash>:
#   unchanged  prod's latest already is this tree         -> nothing to do
#   retag      prod's repo already has tree-<hash>        -> just move latest
#   copy       a PR check already built + scanned it      -> copy from *-ci repo
#   build      nobody has built this source yet           -> build, scan, push
# Outputs: matrix (images to build), copy, deploy (space-separated lists),
# and tag_backend / tag_frontend.
set -euo pipefail
REGION=${AWS_REGION:-ap-south-1}
digest() {  # repo tag -> image digest, or None
  aws ecr batch-get-image --region "$REGION" --repository-name "$1" --image-ids imageTag="$2" \
    --query 'images[0].imageId.imageDigest' --output text 2>/dev/null || echo None
}
include='[]'; copy=''; deploy=''
for IMG in backend frontend; do
  TAG="tree-$(git rev-parse "HEAD:$IMG" | cut -c1-12)"
  REPO="bcc-cvote-$IMG"
  LATEST=$(digest "$REPO" latest)
  HAVE=$(digest "$REPO" "$TAG")
  if [ "$HAVE" != "None" ] && [ "$HAVE" = "$LATEST" ]; then
    action=unchanged
  elif [ "$HAVE" != "None" ]; then
    action=retag
  elif [ "$(digest "$REPO-ci" "$TAG")" != "None" ]; then
    action=copy
  else
    action=build
  fi
  echo "$IMG ($TAG): $action"
  echo "tag_$IMG=$TAG" >> "$GITHUB_OUTPUT"
  case $action in
    build) include=$(echo "$include" | jq -c --arg i "$IMG" --arg r "$REPO" --arg t "$TAG" '. + [{image: $i, repo: $r, tag: $t}]')
           deploy="$deploy $IMG" ;;
    copy)  copy="$copy $IMG"; deploy="$deploy $IMG" ;;
    retag) deploy="$deploy $IMG" ;;
  esac
done
{
  echo "matrix={\"include\":$include}"
  echo "builds=$(echo "$include" | jq -r 'map(.image) | join(" ")')"
  echo "copy=${copy# }"
  echo "deploy=${deploy# }"
} >> "$GITHUB_OUTPUT"
