/**
 * Patches integrations Google OAuth XanoScript (API 205 start, 208 callback):
 * use GOOGLE_REDIRECT_URI for authorize + token redirect_uri.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'xano-patches')

let xs205 = `query "email/google/oauth/start" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
    text return_url? filters=trim
  }

  stack {
    var $user_id {
      value = $auth.id|to_int
    }
  
    db.get user {
      field_name = "id"
      field_value = $user_id
    } as $user
  
    precondition ($user != null && $user.organisation_id != null) {
      error_type = "accessdenied"
      error = "Account context required."
    }
  
    precondition (($env.GOOGLE_CLIENT_ID|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID in Xano environment variables."
    }
  
    precondition (($env.GOOGLE_REDIRECT_URI|to_text|strlen) > 0) {
      error_type = "inputerror"
      error = "Gmail OAuth is not configured. Set GOOGLE_REDIRECT_URI (must match Google Cloud Console redirect URI for this Xano host exactly)."
    }
  
    var $default_return_url {
      value = $env.dashboard_google_return_url|to_text
    }
  
    conditional {
      if (($default_return_url|strlen) == 0) {
        var.update $default_return_url {
          value = $env.dashboard_outlook_return_url|to_text
        }
      }
    }
  
    conditional {
      if (($default_return_url|strlen) == 0) {
        var.update $default_return_url {
          value = "https://app.bokito.ai/settings/inbox"
        }
      }
    }
  
    var $resolved_return_url {
      value = $default_return_url
    }
  
    conditional {
      if (($input.return_url|strlen) > 0) {
        var.update $resolved_return_url {
          value = $input.return_url
        }
      }
    }
  
    security.create_uuid as $nonce
    var $expires_at {
      value = now|add_secs_to_timestamp:900
    }
  
    db.add email_outlook_oauth_state {
      data = {
        organisation_id: $user.organisation_id
        nonce          : $nonce
        user_id        : $user.id
        expires_at     : $expires_at
        return_url     : $resolved_return_url
        feature        : "gmail-email"
      }
    } as $state_row
  
    var $scope {
      value = "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
    }
  
    var $client_id_enc {
      value = $env.GOOGLE_CLIENT_ID|to_text|url_encode_rfc3986
    }
  
    var $redirect_enc {
      value = $env.GOOGLE_REDIRECT_URI|to_text|url_encode_rfc3986
    }
  
    var $scope_enc {
      value = $scope|url_encode_rfc3986
    }
  
    var $state_enc {
      value = $nonce|to_text|url_encode_rfc3986
    }
  
    var $authorize_url {
      value = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" ~ $client_id_enc ~ "&redirect_uri=" ~ $redirect_enc ~ "&response_type=code&scope=" ~ $scope_enc ~ "&access_type=offline&include_granted_scopes=true&prompt=consent&state=" ~ $state_enc
    }
  }

  response = {authorize_url: $authorize_url}
}`

const transcript = path.join(
  'C:',
  'Users',
  'Test',
  '.cursor',
  'projects',
  'c-Users-Test-Documents-Coding-BokitoAiV2',
  'agent-transcripts',
  'aa21da75-e8d7-4081-a412-474c820d6214',
  'aa21da75-e8d7-4081-a412-474c820d6214.jsonl'
)

function parseLine(index) {
  const line = fs.readFileSync(transcript, 'utf8').split(/\n/)[index]
  const row = JSON.parse(line)
  const tool = row.message.content.find(
    (c) => c.type === 'tool_use' && c.name === 'CallMcpTool'
  )
  return tool.input.arguments.xanoscript
}

// 208 baseline from transcript line index 477 (CallMcpTool updateAPI for oauth/google/callback).
let xs208 = parseLine(477)
const oldG =
  '|set:"redirect_uri":"https://api.bokito.ai/api:integrations/oauth/google/callback"'
const newG = '|set:"redirect_uri":($env.GOOGLE_REDIRECT_URI|to_text)'
xs208 = xs208.split(oldG).join(newG)
if (!xs208.includes('($env.GOOGLE_REDIRECT_URI|to_text)')) {
  console.error('208 patch failed')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'email-google-oauth-start-205-env-redirect.xs'), xs205)
fs.writeFileSync(path.join(outDir, 'oauth-google-callback-208-env-redirect.xs'), xs208)

for (const id of [205, 208]) {
  const f =
    id === 205
      ? 'email-google-oauth-start-205-env-redirect.xs'
      : 'oauth-google-callback-208-env-redirect.xs'
  const xanoscript = fs.readFileSync(path.join(outDir, f), 'utf8')
  fs.writeFileSync(
    path.join(outDir, `mcp-update-${id}.json`),
    JSON.stringify({
      workspace_id: 1,
      apigroup_id: 17,
      api_id: id,
      publish: true,
      include_xanoscript: true,
      xanoscript,
    })
  )
}
console.log('Wrote mcp-update-205.json and mcp-update-208.json')
