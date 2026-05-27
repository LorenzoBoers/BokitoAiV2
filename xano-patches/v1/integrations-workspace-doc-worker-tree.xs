// POST /api:integrations/workspace/doc/worker/tree
// Worker-only endpoint to fetch the project doc page tree (no blocks).
// Used by the runtime to build a "doc map" for agent prompt context.
query "workspace/doc/worker/tree" verb=POST {
  api_group = "integrations"
  auth = "none"

  input {
    text token
    uuid workspace_doc_id
    uuid tenant_id
  }

  stack {
    precondition ($input.token == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Worker token mismatch."
    }

    db.query workspace_docs {
      where = $db.workspace_docs.project_id == $input.workspace_doc_id && $db.workspace_docs.tenant_id == $input.tenant_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $doc_rows

    var $doc {
      value = ($doc_rows|count) > 0 ? ($doc_rows|first) : null
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.project_id == $input.workspace_doc_id && $db.workspace_doc_pages.tenant_id == $input.tenant_id && $db.workspace_doc_pages.archived_at == null
      sort = {workspace_doc_pages.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $pages
  }

  response = {
    doc  : $doc
    pages: $pages.items
  }
}
