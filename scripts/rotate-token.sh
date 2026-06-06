#!/usr/bin/env bash
set -euo pipefail
PLATFORM="${1:?Usage: rotate-token.sh <platform> <account>}"
ACCOUNT="${2:?Usage: rotate-token.sh <platform> <account>}"
echo "Rotating token for ${PLATFORM}/${ACCOUNT}"
read -rsp "Enter new access token: " TOKEN; echo
printf '%s' "${TOKEN}" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}" --data-file=-
read -rp "Enter token expiry (ISO, e.g. 2026-08-01T00:00:00Z): " EXPIRES
printf '%s' "${EXPIRES}" | gcloud secrets versions add "${PLATFORM}--${ACCOUNT}--expires" --data-file=-
echo "Token rotated. No redeploy needed."
