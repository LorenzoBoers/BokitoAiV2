// GET /api:workforce/projects/{project_id}/doc/pages/{page_id}/revisions
// List recent revisions for a page (or for a single block if block_id is
// passed). Used by the RevisionPanel for revert.
query "projects/{project_id}/doc/pages/{page_id}/revisions" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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

    db.query doc_pages {
      where = $db.doc_pages.id == $input.page_id && $db.doc_pages.project_id == $input.project_id && $db.doc_pages.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    db.query doc_block_revisions {
      where = $db.doc_block_revisions.page_id == $input.page_id && $db.doc_block_revisions.tenant_id == $me.organisation_id && $db.doc_block_revisions.block_id ==? $input.block_id
      sort = {doc_block_revisions.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $input.per_page}}
    } as $revs
  }

  response = $revs.items
}
