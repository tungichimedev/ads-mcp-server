#!/usr/bin/env bash
set -euo pipefail
PLATFORM="${1:?Usage: rotate-token.sh <platform> <account>}"
ACCOUNT="${2:?Usage: rotate-token.sh <platform> <account>}"
echo "Rotating token for ${PLATFORM}/${ACCOUNT}"
read -rsp "Enter new access token: " TOKEN; echo
echo -n "${TOKEN}" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}" --data-file=-
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}--expires" --data-file=-
echo "Token rotated. No redeploy needed."
