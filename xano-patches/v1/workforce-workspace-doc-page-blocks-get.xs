// GET /api:workforce/workspace/doc/pages/{page_id}/blocks
// Returns all blocks on a page (flat list, ordered by position).
// workspace_doc_blocks uses column block_type (not type) so return = {type: "list"} is safe.
query "workspace/doc/pages/{page_id}/blocks" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid page_id
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "No organisation context."
    }

    db.get workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
    } as $page

    precondition ($page != null && $page.tenant_id == $me.organisation_id) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query workspace_doc_blocks {
      where = $db.workspace_doc_blocks.page_id == $input.page_id && $db.workspace_doc_blocks.tenant_id == $me.organisation_id
      sort = {workspace_doc_blocks.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $blocks_query

    var $block_list {
      value = $blocks_query.items != null ? $blocks_query.items : []
    }
  }

  response = {
    page  : $page
    blocks: $block_list
  }
}
