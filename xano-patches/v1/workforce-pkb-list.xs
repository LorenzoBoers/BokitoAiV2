// List PKB sections for a project, optionally filtered by layer and domain
// Sort by priority asc (1 = highest) then updated_at asc as tiebreaker.
// Note: pkb_sections has no created_at column. Earlier version used
// pkb_sections.created_at which would 400 once any row existed.
query pkb verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    // Project ID
    uuid project_id

    // Filter by layer: current_state, intended_state, change_queue
    text layer?

    // Filter by domain: code, marketing, research, design, operations, other
    text domain?

    int page?=1
    int per_page?=50
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

    db.query pkb_sections {
      where = $db.pkb_sections.project_id == $input.project_id && $db.pkb_sections.tenant_id == $me.organisation_id && $db.pkb_sections.layer ==? $input.layer && $db.pkb_sections.domain ==? $input.domain
      sort = {pkb_sections.priority: "asc", pkb_sections.updated_at: "asc"}
      return = {
        type  : "list"
        paging: {
          page    : $input.page
          per_page: $input.per_page
          totals  : true
        }
      }
    } as $sections
  }

  response = $sections
}
