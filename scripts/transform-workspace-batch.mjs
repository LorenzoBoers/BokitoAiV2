import fs from 'node:fs'
import path from 'node:path'

const src = path.join(import.meta.dirname, '../xano-patches/v1/workforce-doc-page-blocks-batch.xs')
const dest = path.join(import.meta.dirname, '../xano-patches/v1/workforce-workspace-doc-page-blocks-batch.xs')

let s = fs.readFileSync(src, 'utf8')
s = s.replace(/\/api:workforce\/projects\/\{project_id\}\/doc/g, '/api:workforce/workspace/doc')
s = s.replace(/query "projects\/\{project_id\}\/doc\/pages\/\{page_id\}\/blocks"/, 'query "workspace/doc/pages/{page_id}/blocks"')
s = s.replace(/uuid project_id\n    uuid page_id/, 'uuid page_id')
s = s.replace(/object\[\] ops/, 'json ops')
s = s.replace(/doc_block_revisions/g, 'workspace_doc_block_revisions')
s = s.replace(/doc_blocks/g, 'workspace_doc_blocks')
s = s.replace(/doc_pages/g, 'workspace_doc_pages')
s = s.replace(
  /where = \$db\.workspace_doc_pages\.id == \$input\.page_id && \$db\.workspace_doc_pages\.project_id == \$input\.project_id && \$db\.workspace_doc_pages\.tenant_id/g,
  'where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.tenant_id',
)
s = s.replace(/project_id\s*:\s*\$input\.project_id/g, 'workspace_doc_id: $page.workspace_doc_id')
s = s.replace(/\/doc\/reindex-page/g, '/workspace/doc/reindex-page')
s = s.replace(
  /params = \{\s*project_id: \$input\.project_id\s*tenant_id/g,
  'params = {\n        workspace_doc_id: $page.workspace_doc_id\n        tenant_id',
)
fs.writeFileSync(dest, s)
console.log('wrote', dest)
