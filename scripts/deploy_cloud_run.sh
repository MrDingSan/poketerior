#!/usr/bin/env bash
# Build the Docker image with Cloud Build and deploy it to Cloud Run (same pattern as North One's ETF API).
# Secrets come from Secret Manager; seed them once with scripts/deploy_cloud_run.sh --seed-secrets (reads .env).
set -euo pipefail

GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"
PROJECT_ID="${PROJECT_ID:-poketerior-kevin-2026}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-poketerior}"
REPO="${REPO:-poketerior}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-poketerior-runner@${PROJECT_ID}.iam.gserviceaccount.com}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/app:$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)}"
SECRETS=(NEBIUS_API_KEY GEMINI_API_KEY OPENROUTER_API_KEY)

cd "$(dirname "$0")/.."

secret_name() { echo "$1" | tr '[:upper:]_' '[:lower:]-'; }

if [[ "${1:-}" == "--seed-secrets" ]]; then
  for key in "${SECRETS[@]}"; do
    value="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
    [[ -z "$value" ]] && { echo "skip $key (not in .env)"; continue; }
    name="$(secret_name "$key")"
    "$GCLOUD_BIN" secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1 \
      || "$GCLOUD_BIN" secrets create "$name" --project "$PROJECT_ID" --replication-policy automatic >/dev/null
    printf '%s' "$value" | "$GCLOUD_BIN" secrets versions add "$name" --project "$PROJECT_ID" --data-file=- >/dev/null
    echo "stored $key -> $name"
  done
  exit 0
fi

"$GCLOUD_BIN" artifacts repositories describe "$REPO" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1 \
  || "$GCLOUD_BIN" artifacts repositories create "$REPO" --project "$PROJECT_ID" --location "$REGION" --repository-format docker

"$GCLOUD_BIN" iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || "$GCLOUD_BIN" iam service-accounts create "${SERVICE_ACCOUNT%%@*}" --project "$PROJECT_ID" --display-name "PokeTerior Cloud Run"

set_secrets=()
for key in "${SECRETS[@]}"; do
  name="$(secret_name "$key")"
  "$GCLOUD_BIN" secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1 || continue
  "$GCLOUD_BIN" secrets add-iam-policy-binding "$name" --project "$PROJECT_ID" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" --role roles/secretmanager.secretAccessor >/dev/null
  set_secrets+=("${key}=${name}:latest")
done

"$GCLOUD_BIN" builds submit . --project "$PROJECT_ID" --region "$REGION" --tag "$IMAGE"

# Scale-to-zero + a 2-instance cap keeps idle cost at $0 and bounds spend once the URL is public.
# 4 vCPU because TexasSolver is CPU-bound (~15s per solve on 4 cores); CPU is billed only during requests.
"$GCLOUD_BIN" run deploy "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
  --image "$IMAGE" --allow-unauthenticated --min-instances 0 --max-instances 2 \
  --cpu 4 --memory 4Gi --concurrency 8 --timeout 300 --cpu-boost \
  --service-account "$SERVICE_ACCOUNT" \
  --set-env-vars "^@^IMPORT_PROVIDER_ORDER=${IMPORT_PROVIDER_ORDER:-openrouter,gemini}@OPENROUTER_IMPORT_MODEL=${OPENROUTER_IMPORT_MODEL:-qwen/qwen3-vl-32b-instruct}" \
  ${set_secrets:+--set-secrets "$(IFS=,; echo "${set_secrets[*]}")"}

URL="$("$GCLOUD_BIN" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo "Deployed: $URL"
