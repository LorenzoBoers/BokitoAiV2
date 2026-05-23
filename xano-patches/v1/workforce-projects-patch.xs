// PATCH /api:workforce/projects/{project_id} - update project fields
query "projects/{project_id}" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text name?
    text description?
    text autonomous_scope?
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
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $updated {
      value = $rows|first
    }

    conditional {
      if ($input.name != null && ($input.name|strlen) > 0) {
        db.edit projects {
          field_name = "id"
          field_value = $input.project_id
          data = {name: $input.name, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.description != null) {
        db.edit projects {
          field_name = "id"
          field_value = $input.project_id
          data = {description: $input.description, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.autonomous_scope != null && ($input.autonomous_scope|strlen) > 0) {
        db.edit projects {
          field_name = "id"
          field_value = $input.project_id
          data = {autonomous_scope: $input.autonomous_scope, updated_at: now}
        } as $updated
      }
    }
  }

  response = $updated
}
