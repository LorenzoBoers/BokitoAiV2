// GET /api:workforce/projects/{project_id}/doc/change-requests
// List change requests for a project doc, sorted by status then created_at.
query "projects/{project_id}/doc/change-requests" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text status?
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

    db.query doc_change_requests {
      where = $db.doc_change_requests.project_id == $input.project_id && $db.doc_change_requests.tenant_id == $me.organisation_id && $db.doc_change_requests.status ==? $input.status
      sort = {doc_change_requests.priority: "asc", doc_change_requests.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $input.per_page}}
    } as $rows
  }

  response = $rows.items
}
