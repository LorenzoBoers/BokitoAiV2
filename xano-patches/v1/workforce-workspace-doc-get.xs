// GET /api:workforce/workspace/doc - tenant workspace documentation tree.
// Creates workspace_docs on first visit (race-safe). Client seeds pages when empty.
query "workspace/doc" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
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

    db.query workspace_docs {
      where = $db.workspace_docs.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $workspace_doc_rows

    conditional {
      if (($workspace_doc_rows|count) == 0) {
        try_catch {
          try {
            security.create_uuid as $new_workspace_doc_id

            db.add workspace_docs {
              data = {
                id        : $new_workspace_doc_id
                tenant_id : $me.organisation_id
                title     : "Workspace documentation"
                updated_at: now
              }
            }
          }
          catch {
            // Another request may have created the row (unique tenant_id).
          }
        }
      }
    }

    db.get workspace_docs {
      field_name = "tenant_id"
      field_value = $me.organisation_id
    } as $workspace_root

    precondition ($workspace_root != null) {
      error_type = "inputerror"
      error = "Failed to initialise workspace documentation."
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.tenant_id == $me.organisation_id
      sort = {workspace_doc_pages.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $pages

    var $page_list {
      value = $pages.items != null ? $pages.items : []
    }
  }

  response = {
    workspace_doc: $workspace_root|pick:["id", "tenant_id", "title", "updated_at"]
    pages        : $page_list
  }
}
