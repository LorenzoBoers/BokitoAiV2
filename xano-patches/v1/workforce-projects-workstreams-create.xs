// POST /api:workforce/projects/{project_id}/workstreams
query "projects/{project_id}/workstreams" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text name filters=trim|min:1
    text slug filters=trim|min:1
    enum status?=draft {
      values = ["active", "draft", "paused"]
    }
    text trigger_text?
    text output_text?
    json steps?
    int position?
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

    var $stream_id {
      value = ""|uuid
    }

    db.add project_workstreams {
      data = {
        id            : $stream_id
        tenant_id     : $me.organisation_id
        project_id    : $input.project_id
        name          : $input.name
        slug          : $input.slug
        status        : $input.status != null ? $input.status : "draft"
        trigger_text  : $input.trigger_text
        output_text   : $input.output_text
        steps         : $input.steps != null ? $input.steps : []
        position      : $input.position != null ? $input.position : 0
        last_active_at: null
        created_at    : now
        updated_at    : now
      }
    } as $created
  }

  response = $created
}
