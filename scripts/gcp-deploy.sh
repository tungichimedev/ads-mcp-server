#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID:-ads-mcp-server}"
REGION="${GCP_REGION:-us-central1}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ads-mcp-server/ads-mcp-server"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet 2>/dev/null || true
echo "Building..."
docker build -t "${IMAGE}:latest" .
echo "Pushing..."
docker push "${IMAGE}:latest"
echo "Deploying..."
gcloud run deploy ads-mcp-server --image="${IMAGE}:latest" --region="${REGION}" --platform=managed --quiet
SERVICE_URL=$(gcloud run services describe ads-mcp-server --region="${REGION}" --format='value(status.url)')
echo "Deployed: ${SERVICE_URL}"
