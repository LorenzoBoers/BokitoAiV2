// POST /api:integrations/workspace/doc/worker/reindex-page
// Worker-only endpoint to fetch a page's blocks (with the page slug + title)
// so the runtime can embed them and upsert into index_chunks.
query "workspace/doc/worker/reindex-page" verb=POST {
  api_group = "integrations"
  auth = "none"

  input {
    text token
    uuid workspace_doc_id
    uuid tenant_id
    uuid page_id
  }

  stack {
    precondition ($input.token == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Worker token mismatch."
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.workspace_doc_id == $input.workspace_doc_id && $db.workspace_doc_pages.tenant_id == $input.tenant_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query workspace_doc_blocks {
      where = $db.workspace_doc_blocks.page_id == $input.page_id && $db.workspace_doc_blocks.tenant_id == $input.tenant_id
      sort = {workspace_doc_blocks.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $blocks_query

    var $block_list {
      value = $blocks_query.items != null ? $blocks_query.items : []
    }
  }

  response = {
    page  : $page_rows|first
    blocks: $block_list
  }
}
