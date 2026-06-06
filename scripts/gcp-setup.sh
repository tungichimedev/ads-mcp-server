#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-ads-mcp-server}"
REGION="${GCP_REGION:-us-central1}"
REPO_NAME="ads-mcp-server"
SERVICE_NAME="ads-mcp-server"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

echo "=== GCP Setup for ads-mcp-server ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo ""

echo "1/8 Checking GCP project..."
if ! gcloud projects describe "${PROJECT_ID}" &>/dev/null; then
  echo "Creating project ${PROJECT_ID}..."
  gcloud projects create "${PROJECT_ID}" --quiet
fi
gcloud config set project "${PROJECT_ID}"

echo "2/8 Checking billing..."
BILLING_ACCOUNT=$(gcloud billing accounts list --format='value(name)' --limit=1)
if [ -n "${BILLING_ACCOUNT}" ]; then
  gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" --quiet 2>/dev/null || true
fi

echo "3/8 Enabling APIs..."
gcloud services enable run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com --quiet

echo "4/8 Setting up Artifact Registry..."
if ! gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" --repository-format=docker --location="${REGION}" --quiet
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "5/8 Setting up secrets..."
echo "Enter your config.json (paste and press Ctrl-D):"
CONFIG_JSON=$(cat)
echo "${CONFIG_JSON}" | gcloud secrets create ads-mcp-config --data-file=- --quiet 2>/dev/null \
  || echo "${CONFIG_JSON}" | gcloud secrets versions add ads-mcp-config --data-file=- --quiet

echo ""
echo "For each platform, enter credentials when prompted (or press Enter to skip)."
for PLATFORM in meta google tiktok; do
  read -rp "  ${PLATFORM} account name (or Enter to skip): " ACCT
  [ -z "${ACCT}" ] && continue
  read -rsp "  ${PLATFORM} access token: " TOKEN; echo
  echo -n "${TOKEN}" | gcloud secrets create "${PLATFORM}--${ACCT}" --data-file=- --quiet 2>/dev/null \
    || echo -n "${TOKEN}" | gcloud secrets versions add "${PLATFORM}--${ACCT}" --data-file=- --quiet
  read -rp "  ${PLATFORM} token expiry (ISO, e.g. 2026-08-01T00:00:00Z): " EXPIRES
  [ -n "${EXPIRES}" ] && (echo -n "${EXPIRES}" | gcloud secrets create "${PLATFORM}--${ACCT}--expires" --data-file=- --quiet 2>/dev/null \
    || echo -n "${EXPIRES}" | gcloud secrets versions add "${PLATFORM}--${ACCT}--expires" --data-file=- --quiet)
  if [ "${PLATFORM}" = "google" ]; then
    read -rsp "  Google client_id: " CID; echo
    [ -n "${CID}" ] && (echo -n "${CID}" | gcloud secrets create "google--${ACCT}--client_id" --data-file=- --quiet 2>/dev/null \
      || echo -n "${CID}" | gcloud secrets versions add "google--${ACCT}--client_id" --data-file=- --quiet)
    read -rsp "  Google client_secret: " CSEC; echo
    [ -n "${CSEC}" ] && (echo -n "${CSEC}" | gcloud secrets create "google--${ACCT}--client_secret" --data-file=- --quiet 2>/dev/null \
      || echo -n "${CSEC}" | gcloud secrets versions add "google--${ACCT}--client_secret" --data-file=- --quiet)
    read -rsp "  Google developer_token: " DTOK; echo
    [ -n "${DTOK}" ] && (echo -n "${DTOK}" | gcloud secrets create "google--${ACCT}--developer_token" --data-file=- --quiet 2>/dev/null \
      || echo -n "${DTOK}" | gcloud secrets versions add "google--${ACCT}--developer_token" --data-file=- --quiet)
  fi
done

echo "6/8 Building and pushing Docker image..."
docker build -t "${IMAGE}:latest" .
docker push "${IMAGE}:latest"

echo "7/8 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}:latest" --region="${REGION}" --platform=managed \
  --port=8080 --memory=256Mi --cpu=1 --timeout=300 --concurrency=10 \
  --min-instances=0 --max-instances=1 --no-allow-unauthenticated --quiet

SA=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(spec.template.spec.serviceAccountName)')
gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor" --quiet
gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member="serviceAccount:${SA}" --role="roles/secretmanager.secretVersionManager" --quiet

echo "8/8 Setting up IAM..."
CURRENT_USER=$(gcloud config get-value account)
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" --region="${REGION}" --member="user:${CURRENT_USER}" --role="roles/run.invoker" --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format='value(status.url)')
echo ""
echo "=== Setup Complete ==="
echo "Service URL: ${SERVICE_URL}"
echo ""
echo "Claude Code MCP config (~/.claude.json):"
echo '{'
echo '  "mcpServers": {'
echo '    "ads": {'
echo '      "command": "bash",'
echo "      \"args\": [\"$(pwd)/scripts/mcp-proxy.sh\"],"
echo '      "env": {'
echo "        \"ADS_MCP_URL\": \"${SERVICE_URL}\""
echo '      }'
echo '    }'
echo '  }'
echo '}'
