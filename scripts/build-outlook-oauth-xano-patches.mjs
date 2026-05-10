import fs from 'node:fs'
import pathMod from 'node:path'
import { fileURLToPath } from 'node:url'

/** Outlook 103/209 patches from agent transcript line indices 403 and 476; re-verify if transcript changes. */

const __dirname = pathMod.dirname(fileURLToPath(import.meta.url))
const root = pathMod.join(__dirname, '..')
const transcript = pathMod.join(
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

const oldRedirect209 =
  '|set:"redirect_uri":"https://api.bokito.ai/api:integrations/oauth/microsoft/callback"'
const newRedirect209 = '|set:"redirect_uri":($env.MICROSOFT_REDIRECT_URI|to_text)'

let xs209 = parseLine(476)
xs209 = xs209.split(oldRedirect209).join(newRedirect209)
if (!xs209.includes('($env.MICROSOFT_REDIRECT_URI|to_text)')) {
  console.error('209 patch failed')
  process.exit(1)
}

let xs103 = parseLine(403)
if (!xs103.includes('MICROSOFT_REDIRECT_URI|to_text|strlen')) {
  const needle =
    'error = "Outlook OAuth is not configured. Set Xano environment variables MICROSOFT_CLIENT_ID (Azure Application ID)."\n    }\n  \n    var $default_return_url'
  const insert =
    'error = "Outlook OAuth is not configured. Set Xano environment variables MICROSOFT_CLIENT_ID (Azure Application ID)."\n    }\n  \n    precondition (($env.MICROSOFT_REDIRECT_URI|to_text|strlen) > 0) {\n      error_type = "inputerror"\n      error = "Outlook OAuth is not configured. Set Xano environment variable MICROSOFT_REDIRECT_URI (must match Azure Web redirect URI for this Xano host exactly)."\n    }\n  \n    var $default_return_url'
  if (!xs103.includes(needle)) {
    console.error('103: insert point not found')
    process.exit(1)
  }
  xs103 = xs103.split(needle).join(insert)
}
const oldEnc =
  'value = "https://api.bokito.ai/api:integrations/oauth/microsoft/callback"|url_encode_rfc3986'
const newEnc = 'value = $env.MICROSOFT_REDIRECT_URI|to_text|url_encode_rfc3986'
xs103 = xs103.split(oldEnc).join(newEnc)
if (!xs103.includes(newEnc)) {
  console.error('103 redirect_enc patch failed')
  process.exit(1)
}

const outDir = pathMod.join(root, 'xano-patches')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(pathMod.join(outDir, 'oauth-microsoft-callback-209-env-redirect.xs'), xs209)
fs.writeFileSync(pathMod.join(outDir, 'email-outlook-oauth-start-103-env-redirect.xs'), xs103)
console.log('OK: xano-patches/oauth-microsoft-callback-209-env-redirect.xs')
console.log('OK: xano-patches/email-outlook-oauth-start-103-env-redirect.xs')
