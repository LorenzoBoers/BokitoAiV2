// POST /api:workforce/workspace/doc/worker/pages/{page_id}/projections
// Worker-only endpoint to persist derived markdown/plaintext projections
// after runtime indexing.
query "workspace/doc/worker/pages/{page_id}/projections" verb=POST {
  api_group = "workforce"
  auth = "none"

  input {
    text worker_api_key
    uuid page_id
    uuid tenant_id
    text rendered_markdown?
    text rendered_plaintext?
    text content_hash?
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.tenant_id == $input.tenant_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.edit workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {
        rendered_markdown : $input.rendered_markdown != null ? $input.rendered_markdown : null
        rendered_plaintext: $input.rendered_plaintext != null ? $input.rendered_plaintext : null
        content_hash      : $input.content_hash != null ? $input.content_hash : null
        last_indexed_at   : now
        updated_at        : now
      }
    } as $page
  }

  response = {ok: true, page_id: $input.page_id}
}
