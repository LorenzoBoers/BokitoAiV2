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
    } as $doc_rows

    var $doc {
      value = ($doc_rows|count) > 0 ? ($doc_rows|first) : null
    }

    conditional {
      if ($doc == null) {
        security.create_uuid as $doc_id

        db.add workspace_docs {
          data = {
            id        : $doc_id
            tenant_id : $me.organisation_id
            title     : "Workspace documentation"
            created_at: now
            updated_at: now
          }
        } as $new_doc

        var.update $doc {
          value = $new_doc
        }
      }
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.workspace_doc_id == $doc.id && $db.workspace_doc_pages.tenant_id == $me.organisation_id && $db.workspace_doc_pages.archived_at == null
      sort = {workspace_doc_pages.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $pages
  }

  response = {
    doc  : $doc
    pages: $pages.items
  }
}
