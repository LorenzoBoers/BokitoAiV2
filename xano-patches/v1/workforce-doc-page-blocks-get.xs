// GET /api:workforce/projects/{project_id}/doc/pages/{page_id}/blocks
// Returns all blocks on a page (flat list, ordered by parent_block_id +
// position). Frontend assembles the tree.
query "projects/{project_id}/doc/pages/{page_id}/blocks" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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

    db.query doc_pages {
      where = $db.doc_pages.id == $input.page_id && $db.doc_pages.project_id == $input.project_id && $db.doc_pages.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query doc_blocks {
      where = $db.doc_blocks.page_id == $input.page_id && $db.doc_blocks.tenant_id == $me.organisation_id
      sort = {doc_blocks.position: "asc", doc_blocks.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $blocks
  }

  response = {
    page  : $page_rows|first
    blocks: $blocks.items
  }
}
