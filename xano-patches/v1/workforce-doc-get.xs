// GET /api:workforce/projects/{project_id}/doc
// Returns the project's documentation root + page tree (no blocks).
// If the project has no project_docs row yet (legacy projects from before
// the block-based doc system), one is created on-the-fly with the default
// PRD scaffold so the UI never shows an empty state.
query "projects/{project_id}/doc" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $project {
      value = $proj_rows|first
    }

    db.query project_docs {
      where = $db.project_docs.project_id == $input.project_id && $db.project_docs.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $doc_rows

    var $doc {
      value = ($doc_rows|count) > 0 ? ($doc_rows|first) : null
    }

    conditional {
      if ($doc == null) {
        security.create_uuid as $doc_id

        db.add project_docs {
          data = {
            id        : $doc_id
            tenant_id : $me.organisation_id
            project_id: $input.project_id
            title     : $project.name
            created_at: now
            updated_at: now
          }
        } as $new_doc

        var.update $doc {
          value = $new_doc
        }
      }
    }

    db.query doc_pages {
      where = $db.doc_pages.doc_id == $doc.id && $db.doc_pages.tenant_id == $me.organisation_id && $db.doc_pages.archived_at == null
      sort = {doc_pages.position: "asc", doc_pages.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $pages
  }

  response = {
    doc  : $doc
    pages: $pages.items
  }
}
