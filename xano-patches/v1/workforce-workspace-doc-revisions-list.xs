// GET /api:workforce/workspace/doc/pages/{page_id}/revisions
// List recent revisions for a page (or for a single block if block_id is
// passed). Used by the RevisionPanel for revert.
query "workspace/doc/pages/{page_id}/revisions" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
        uuid page_id
    uuid block_id?
    int per_page?=50
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

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query workspace_doc_block_revisions {
      where = $db.workspace_doc_block_revisions.page_id == $input.page_id && $db.workspace_doc_block_revisions.tenant_id == $me.organisation_id && $db.workspace_doc_block_revisions.block_id ==? $input.block_id
      sort = {workspace_doc_block_revisions.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $input.per_page}}
    } as $revs
  }

  response = $revs.items
}
