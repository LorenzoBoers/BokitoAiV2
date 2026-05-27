// GET /api:workforce/work_logs - tenant-scoped run list for admin UI
query "work_logs" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    text project_id?
    uuid agent_id?
    text status?
    int limit?=50
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

    var $per_page {
      value = $input.limit != null && $input.limit > 0 ? $input.limit : 50
    }

    db.query work_logs {
      where = $db.work_logs.tenant_id == $me.organisation_id && $db.work_logs.project_id ==? $input.project_id && $db.work_logs.agent_id ==? $input.agent_id && $db.work_logs.status ==? $input.status
      sort = {work_logs.started_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $per_page}}
    } as $rows
  }

  response = $rows
}
