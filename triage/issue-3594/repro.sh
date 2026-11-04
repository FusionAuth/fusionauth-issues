#!/usr/bin/env bash
set -euo pipefail

: "${API_KEY:?Set API_KEY to a FusionAuth API key}"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

check_instance() {
  local label=$1
  local base_url=$2
  local response status app_id app_name
  app_name="Triage #3594 soft-disable check $(date +%s)-$$"

  status=$(curl -sS -o "$tmp_dir/create.json" -w '%{http_code}' \
    -H "Authorization: $API_KEY" \
    -H 'Content-Type: application/json' \
    -X POST "$base_url/api/application" \
    -d "$(jq -cn --arg name "$app_name" '{application:{name:$name}}')")
  if [[ "$status" != 200 ]]; then
    printf '%s: application creation returned HTTP %s\n' "$label" "$status" >&2
    jq '{fieldErrors,generalErrors}' "$tmp_dir/create.json" >&2
    return 1
  fi

  app_id=$(jq -er '.application.id' "$tmp_dir/create.json")
  printf '%s: POST HTTP %s, initially active=' "$label" "$status"
  jq -r '.application.active' "$tmp_dir/create.json"

  status=$(curl -sS -o "$tmp_dir/delete.txt" -w '%{http_code}' \
    -H "Authorization: $API_KEY" \
    -X DELETE "$base_url/api/application/$app_id")
  if [[ "$status" != 200 ]]; then
    printf '%s: soft-delete returned HTTP %s\n' "$label" "$status" >&2
    cat "$tmp_dir/delete.txt" >&2
    return 1
  fi
  printf '%s: DELETE (soft deactivation) HTTP %s\n' "$label" "$status"

  status=$(curl -sS -o "$tmp_dir/inactive.json" -w '%{http_code}' \
    -H "Authorization: $API_KEY" \
    "$base_url/api/application/$app_id?inactive=true")
  if [[ "$status" != 200 ]]; then
    printf '%s: inactive application retrieval returned HTTP %s\n' "$label" "$status" >&2
    jq '{fieldErrors,generalErrors}' "$tmp_dir/inactive.json" >&2
    return 1
  fi

  response=$(jq -c '.application | {id,active,state,name}' "$tmp_dir/inactive.json")
  printf '%s: GET inactive=true HTTP %s, %s\n' "$label" "$status" "$response"
  jq -e '.application.active == false and .application.state == "Inactive"' \
    "$tmp_dir/inactive.json" >/dev/null
}

check_instance 'FusionAuth 1.68.0' 'http://localhost:9012'
check_instance 'FusionAuth latest' 'http://localhost:9011'
