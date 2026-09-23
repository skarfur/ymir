#!/usr/bin/env bash
# tools/gcal-wif-setup.sh — one-time (or rotate-anytime) setup for Google
# Calendar access via Workload Identity Federation. Run this LOCALLY, on
# your own machine — never in a shared/remote environment — since it
# generates a private signing key and pushes it straight to Supabase
# without ever writing it to disk or printing it.
#
# Prerequisites, all logged in / configured before running:
#   - gcloud CLI, authenticated (`gcloud auth login`) against the SAME
#     Google Cloud project that already issues GOOGLE_CLIENT_ID
#     (project number 231967339479 — check with `gcloud config get-value project`
#     or `gcloud projects list`).
#   - supabase CLI, authenticated (`supabase login`) with access to the
#     Ýmir project (ref jilmxhonqhbvieyknyen).
#   - node (any recent version — only uses built-in `crypto`).
#
# What this does:
#   1. Enables the required Google Cloud APIs.
#   2. Creates the Calendar service account (no key downloaded).
#   3. Generates a fresh ES256 keypair (tools/gcal-wif-keygen.js) — public
#      half -> jwks.json (safe, not sensitive), private half -> captured
#      directly into a shell variable, never written to disk here.
#   4. Creates a Workload Identity Pool + OIDC provider, with that public
#      JWKS uploaded directly (no public issuer endpoint needed).
#   5. Grants the pool's specific subject roles/iam.workloadIdentityUser
#      on the service account (impersonation rights, nothing broader).
#   6. Pushes GCAL_WIF_SIGNING_KEY / GCAL_WIF_AUDIENCE / GCAL_WIF_ISSUER /
#      GCAL_WIF_SUBJECT / GCAL_SA_EMAIL to Supabase Edge Function secrets.
#
# After this script finishes, you STILL need to manually share each
# Google Calendar you want synced with the printed service-account email,
# granting "Make changes to events" — that's a per-calendar step in
# Google Calendar's own UI and can't be scripted.
#
# Safe to re-run: gcloud/supabase calls are idempotent enough that a
# second run just updates things in place (a fresh key rotates the
# signing key; the pool/provider/service-account creation steps no-op
# with a message if they already exist — check the output).

set -euo pipefail

# ── Configuration — edit these or pass as env vars before running ──────────
PROJECT_ID="${PROJECT_ID:-}"                       # gcloud project string ID (required)
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-jilmxhonqhbvieyknyen}"
SA_NAME="${SA_NAME:-ymir-calendar-sync}"
POOL_ID="${POOL_ID:-ymir-gcal}"
PROVIDER_ID="${PROVIDER_ID:-ymir-gcal-provider}"
ISSUER="${ISSUER:-https://ymir.internal/gcal-wif}"
SUBJECT="${SUBJECT:-ymir-edge-functions}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Set PROJECT_ID to your Google Cloud project's string ID first, e.g.:" >&2
  echo "  PROJECT_ID=my-ymir-project ./tools/gcal-wif-setup.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "== 1/6: enabling required APIs on $PROJECT_ID =="
gcloud services enable \
  calendar-json.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID"

echo "== 2/6: creating service account $SA_EMAIL (if missing) =="
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT_ID" \
  --display-name="Ymir Calendar Sync" \
  || echo "  (already exists — continuing)"

echo "== 3/6: generating signing keypair =="
PRIV_JWK="$(node "$SCRIPT_DIR/gcal-wif-keygen.js")"
JWKS_PATH="$SCRIPT_DIR/jwks.json"

echo "== 4/6: creating Workload Identity Pool + OIDC provider =="
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --display-name="Ymir Edge Functions" \
  || echo "  (pool already exists — continuing)"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --issuer-uri="$ISSUER" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.iss=='${ISSUER}'" \
  --jwk-json-path="$JWKS_PATH" \
  || {
    echo "  provider may already exist — updating its JWKS instead"
    gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
      --project="$PROJECT_ID" \
      --location=global \
      --workload-identity-pool="$POOL_ID" \
      --jwk-json-path="$JWKS_PATH"
  }

echo "== 5/6: granting impersonation rights (roles/iam.workloadIdentityUser) =="
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
AUDIENCE="//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
PRINCIPAL="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/subject/${SUBJECT}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$PRINCIPAL"

echo "== 6/6: pushing secrets to Supabase (project $SUPABASE_PROJECT_REF) =="
supabase secrets set \
  --project-ref "$SUPABASE_PROJECT_REF" \
  GCAL_WIF_SIGNING_KEY="$PRIV_JWK" \
  GCAL_WIF_AUDIENCE="$AUDIENCE" \
  GCAL_WIF_ISSUER="$ISSUER" \
  GCAL_WIF_SUBJECT="$SUBJECT" \
  GCAL_SA_EMAIL="$SA_EMAIL"

echo ""
echo "Done. Remaining manual step: share each target Google Calendar with"
echo "  $SA_EMAIL"
echo "granting \"Make changes to events\" (Calendar Settings and sharing ->"
echo "Share with specific people or groups)."
echo ""
echo "If GOOGLE_SERVICE_ACCOUNT_JSON is still set from the old downloaded-key"
echo "flow, remove it once the new flow is confirmed working:"
echo "  supabase secrets unset --project-ref $SUPABASE_PROJECT_REF GOOGLE_SERVICE_ACCOUNT_JSON"
