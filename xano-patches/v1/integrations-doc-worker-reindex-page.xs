// POST /api:integrations/doc/worker/reindex-page
// Worker-only endpoint to fetch a page's blocks (with the page slug + title)
// so the runtime can embed them and upsert into index_chunks.
query "doc/worker/reindex-page" verb=POST {
  api_group = "integrations"
  auth = "none"

  input {
    text token
    uuid project_id
    uuid tenant_id
    uuid page_id
  }

  stack {
    precondition ($input.token == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Worker token mismatch."
    }

    db.query doc_pages {
      where = $db.doc_pages.id == $input.page_id && $db.doc_pages.project_id == $input.project_id && $db.doc_pages.tenant_id == $input.tenant_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query doc_blocks {
      where = $db.doc_blocks.page_id == $input.page_id && $db.doc_blocks.tenant_id == $input.tenant_id
      sort = {doc_blocks.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $blocks
  }

  response = {
    page  : $page_rows|first
    blocks: $blocks.items
  }
}
