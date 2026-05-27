// DELETE /api:workforce/workspace/doc/pages/{page_id}
// Soft-delete a page (archived_at). Child pages are not cascade-deleted in v1.
query "workspace/doc/pages/{page_id}" verb=DELETE {
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

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.tenant_id == $me.organisation_id
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
        archived_at: now
        updated_at : now
      }
    } as $archived
  }

  response = {
    archived: true
    page_id : $input.page_id
  }
}
