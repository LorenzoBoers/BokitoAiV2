// POST /api:workforce/projects - create project with required autonomous_scope
query "projects" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    text name filters=trim|min:1
    text slug filters=trim|min:1
    text autonomous_scope filters=trim|min:30
    text description?
    bool autonomous_mode?
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

    db.add projects {
      data = {
        tenant_id       : $me.organisation_id
        name            : $input.name
        slug            : $input.slug
        description     : $input.description
        autonomous_scope: $input.autonomous_scope
        autonomous_mode : $input.autonomous_mode|default:false
        active_domains  : []
      }
    } as $project
  }

  response = $project
}
