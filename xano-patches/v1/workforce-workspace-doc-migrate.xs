// POST /api:workforce/workspace/doc/migrate-from-project
// Copies doc_pages (and blocks) from a project into workspace doc under a folder page.
query "workspace/doc/migrate-from-project" verb=POST {
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

    var $result {
      value = {
        ok           : true
        pages_copied : 0
        message      : "Migration stub: create workspace doc tables then copy project doc_pages into workspace_doc_pages."
      }
    }
  }

  response = $result
}
