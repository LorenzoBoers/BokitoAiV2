# GitHub Actions setup checklist
#
# Run after forking/cloning. Requires GitHub CLI: https://cli.github.com/
#   gh auth login
#
# This script sets repository secrets and documents environment protection.
# It does NOT create GHCR_PULL_TOKEN for you — generate a classic PAT with read:packages.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-LorenzoBoers/BokitoAiV2}"

echo "Configuring deploy secrets for ${REPO}"
echo "You will be prompted for sensitive values."

read -r -p "VPS_HOST [31.97.45.44]: " VPS_HOST
VPS_HOST="${VPS_HOST:-31.97.45.44}"
gh secret set VPS_HOST --body "$VPS_HOST" --repo "$REPO"

read -r -p "VPS_USER [root]: " VPS_USER
VPS_USER="${VPS_USER:-root}"
gh secret set VPS_USER --body "$VPS_USER" --repo "$REPO"

echo "Paste VPS_SSH_KEY (private key, end with empty line):"
VPS_KEY="$(cat)"
gh secret set VPS_SSH_KEY --body "$VPS_KEY" --repo "$REPO"

read -r -s -p "GHCR_PULL_TOKEN (PAT read:packages): " GHCR_TOKEN
echo
gh secret set GHCR_PULL_TOKEN --body "$GHCR_TOKEN" --repo "$REPO"

gh secret set STAGING_SMOKE_EMAIL --body "trader@staging.bokito.ai" --repo "$REPO"
gh secret set STAGING_SMOKE_PASSWORD --body "staging-trader-password" --repo "$REPO"

read -r -p "PROD_SMOKE_EMAIL [trader@chargecars.app]: " PROD_EMAIL
PROD_EMAIL="${PROD_EMAIL:-trader@chargecars.app}"
gh secret set PROD_SMOKE_EMAIL --body "$PROD_EMAIL" --repo "$REPO"

read -r -s -p "PROD_SMOKE_PASSWORD: " PROD_PW
echo
gh secret set PROD_SMOKE_PASSWORD --body "$PROD_PW" --repo "$REPO"

cat <<'EOF'

Next steps (GitHub UI):
1. Settings -> Environments -> New: "staging" (no protection rules)
2. Settings -> Environments -> New: "production" -> Required reviewers: you
3. Push to master; watch Actions -> Deploy

EOF
