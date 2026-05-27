import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '../xano-patches/v1')
const pairs = [
  ['workforce-doc-pages-create.xs', 'workforce-workspace-doc-pages-create.xs'],
  ['workforce-doc-pages-patch.xs', 'workforce-workspace-doc-pages-patch.xs'],
  ['workforce-doc-pages-delete.xs', 'workforce-workspace-doc-pages-delete.xs'],
  ['workforce-doc-page-blocks-get.xs', 'workforce-workspace-doc-page-blocks-get.xs'],
  ['workforce-doc-page-blocks-batch.xs', 'workforce-workspace-doc-page-blocks-batch.xs'],
  ['workforce-doc-revisions-list.xs', 'workforce-workspace-doc-revisions-list.xs'],
  ['workforce-doc-change-requests-create.xs', 'workforce-workspace-doc-change-requests-create.xs'],
  ['integrations-doc-worker-reindex-page.xs', 'integrations-workspace-doc-worker-reindex-page.xs'],
  ['integrations-doc-worker-blocks.xs', 'integrations-workspace-doc-worker-blocks.xs'],
  ['integrations-doc-worker-tree.xs', 'integrations-workspace-doc-worker-tree.xs'],
]

function transformWorkforce(s) {
  return (
    s
      .replace(/doc_block_revisions/g, 'workspace_doc_block_revisions')
      .replace(/doc_blocks/g, 'workspace_doc_blocks')
      .replace(/doc_pages/g, 'workspace_doc_pages')
      .replace(/doc_change_requests/g, 'workspace_doc_change_requests')
      .replace(/project_docs/g, 'workspace_docs')
      .replace(/query "projects\/\{project_id\}\/doc\//g, 'query "workspace/doc/')
      .replace(/uuid project_id\n/g, '')
      .replace(/\$input\.project_id/g, '$doc.id')
      .replace(/project_id\s*:\s*\$doc\.id/g, 'workspace_doc_id: $doc.id')
      .replace(/project_id\s*:\s*\$input\.project_id/g, 'workspace_doc_id: $doc.id')
      .replace(
        /\$db\.workspace_doc_pages\.id == \$input\.page_id && \$db\.workspace_doc_pages\.workspace_doc_id == \$doc\.id/g,
        '$db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.workspace_doc_id == $doc.id',
      )
      .replace(
        /where = \$db\.workspace_doc_pages\.slug == \$slug/g,
        'where = $db.workspace_doc_pages.workspace_doc_id == $doc.id && $db.workspace_doc_pages.slug == $slug',
      )
      .replace(/\/api:workforce\/projects\/\{project_id\}\/doc/g, '/api:workforce/workspace/doc')
      .replace(/GET \/projects\/\{id\}\/doc first/g, 'GET /workspace/doc first')
      .replace(/Project not found/g, 'Workspace doc not found')
      .replace(
        /url = \$env\.WORKER_BASE_URL ~ "\/doc\/reindex-page"/g,
        'url = $env.WORKER_BASE_URL ~ "/workspace/doc/reindex-page"',
      )
      .replace(/params = \{\s*project_id: \$doc\.id/g, 'params = {\n        workspace_doc_id: $doc.id')
      .replace(/params = \{\s*project_id: \$input\.project_id/g, 'params = {\n        workspace_doc_id: $doc.id')
  )
}

function transformIntegrations(s) {
  return (
    s
      .replace(/doc_block_revisions/g, 'workspace_doc_block_revisions')
      .replace(/doc_blocks/g, 'workspace_doc_blocks')
      .replace(/doc_pages/g, 'workspace_doc_pages')
      .replace(/project_docs/g, 'workspace_docs')
      .replace(/query "doc\/worker\//g, 'query "workspace/doc/worker/')
      .replace(/uuid project_id/g, 'uuid workspace_doc_id')
      .replace(/\$input\.project_id/g, '$input.workspace_doc_id')
      .replace(/project_id:/g, 'workspace_doc_id:')
      .replace(/\/api:integrations\/doc\/worker/g, '/api:integrations/workspace/doc/worker')
  )
}

function patchWorkforcePagesCreate(s) {
  const lookup = `
    db.query workspace_docs {
      where = $db.workspace_docs.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $doc_rows

    precondition (($doc_rows|count) > 0) {
      error_type = "inputerror"
      error = "Doc not initialised. GET /workspace/doc first."
    }

    var $doc {
      value = $doc_rows|first
    }
`
  return s.replace(
    /db\.query workspace_docs \{[\s\S]*?var \$doc \{[\s\S]*?\}/,
    lookup.trim(),
  )
}

function patchChangeRequest(s) {
  return s
    .replace(/db\.query projects \{[\s\S]*?var \$project \{[\s\S]*?\}\n\n/, '')
    .replace(
      /where = \$db\.agents\.tenant_id == \$me\.organisation_id && \$db\.agents\.role == "po" && \$db\.agents\.project_id == \$input\.project_id/g,
      'where = $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"',
    )
    .replace(/params = \{\s*project_id : \$input\.project_id/g, 'params = {\n            tenant_id  : $me.organisation_id')
}

for (const [src, dest] of pairs) {
  let s = fs.readFileSync(path.join(dir, src), 'utf8')
  const isInt = dest.startsWith('integrations')
  s = isInt ? transformIntegrations(s) : transformWorkforce(s)
  if (dest.includes('pages-create')) s = patchWorkforcePagesCreate(s)
  if (dest.includes('change-requests-create')) s = patchChangeRequest(s)
  fs.writeFileSync(path.join(dir, dest), s)
  console.log('wrote', dest)
}
