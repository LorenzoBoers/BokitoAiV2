// Create a new project with required autonomous_scope
// Also seeds two pkb_sections rows so the user immediately sees their description
// in the PKB viewer (current_state) and the PO has an intended_state to read.
query projects verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    // Project display name
    text name filters=trim|min:1

    // URL-friendly identifier
    text slug filters=trim|min:1

    // Plain-language description used by PO as north star (min 30 chars)
    text autonomous_scope filters=trim|min:30

    // Short tagline
    text description?

    // Enable autonomous mode
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
        autonomous_mode : $input.autonomous_mode|default:true
        active_domains  : []
      }
    } as $project

    var $submitter_id {
      value = $me.id|to_text
    }

    db.add pkb_sections {
      data = {
        tenant_id        : $me.organisation_id
        project_id       : $project.id
        layer            : "current_state"
        domain           : "operations"
        title            : "What this project is today"
        content          : $input.autonomous_scope
        change_status    : "implemented"
        submitted_by_type: "user"
        submitted_by_id  : $submitter_id
        priority         : 1
      }
    } as $current_section

    db.add pkb_sections {
      data = {
        tenant_id        : $me.organisation_id
        project_id       : $project.id
        layer            : "intended_state"
        domain           : "operations"
        title            : "What this project wants to become"
        content          : $input.autonomous_scope
        change_status    : "pending"
        submitted_by_type: "user"
        submitted_by_id  : $submitter_id
        priority         : 1
      }
    } as $intended_section
  }

  response = $project
}
