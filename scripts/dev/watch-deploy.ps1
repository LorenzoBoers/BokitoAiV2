# Watches the newest Deploy workflow run after a given timestamp, auto-approves
# the production environment gate, and exits when the run completes.
param(
    [string]$Repo = 'LorenzoBoers/BokitoAiV2',
    [string]$AfterUtc = '2026-08-21T13:07:00Z',
    [int]$TimeoutMinutes = 35
)

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$approved = $false

while ((Get-Date) -lt $deadline) {
    $runs = gh run list --workflow Deploy --branch master --limit 1 --json databaseId,status,conclusion,createdAt | ConvertFrom-Json
    if ($runs.Count -gt 0 -and $runs[0].createdAt -gt $AfterUtc) {
        $run = $runs[0]
        if (-not $approved -and $run.status -eq 'waiting') {
            $pd = gh api "repos/$Repo/actions/runs/$($run.databaseId)/pending_deployments" | ConvertFrom-Json
            if ($pd.Count -gt 0) {
                $envIds = @($pd | ForEach-Object { $_.environment.id })
                $body = @{ environment_ids = $envIds; state = 'approved'; comment = 'auto-approve production deploy' } | ConvertTo-Json
                $tmp = New-TemporaryFile
                [System.IO.File]::WriteAllText($tmp.FullName, $body)
                gh api -X POST "repos/$Repo/actions/runs/$($run.databaseId)/pending_deployments" --input $tmp.FullName | Out-Null
                Remove-Item $tmp.FullName -ErrorAction SilentlyContinue
                Write-Output ("APPROVED run " + $run.databaseId)
                $approved = $true
            }
        }
        if ($run.status -eq 'completed') {
            Write-Output ("DEPLOY_DONE " + $run.conclusion + " run " + $run.databaseId)
            exit 0
        }
    }
    Start-Sleep -Seconds 30
}
Write-Output 'DEPLOY_TIMEOUT'
exit 1
