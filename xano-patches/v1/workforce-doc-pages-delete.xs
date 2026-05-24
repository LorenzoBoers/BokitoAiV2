// DELETE /api:workforce/projects/{project_id}/doc/pages/{page_id}
// Soft delete a page by setting archived_at. Children pages are also soft
// deleted (one level deep; deeper trees handled via repeated calls).
query "projects/{project_id}/doc/pages/{page_id}" verb=DELETE {
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

    db.edit doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {
        archived_at: now
        updated_at : now
      }
    } as $archived

    db.query doc_pages {
      where = $db.doc_pages.parent_page_id == $input.page_id && $db.doc_pages.archived_at == null
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $children

    foreach ($children.items as $child) {
      db.edit doc_pages {
        field_name = "id"
        field_value = $child.id
        data = {
          archived_at: now
          updated_at : now
        }
      }
    }
  }

  response = {
    archived: true
    page_id : $input.page_id
  }
}
