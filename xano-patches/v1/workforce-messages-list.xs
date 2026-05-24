// GET /api:workforce/messages - tenant-scoped message list for portal
query "messages" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    text status?
    text message_type?
    text channel?
    text thread_id?
    uuid project_id?
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

    db.query messages {
      where = $db.messages.tenant_id == $me.organisation_id && $db.messages.status ==? $input.status && $db.messages.message_type ==? $input.message_type && $db.messages.channel ==? $input.channel && $db.messages.thread_id ==? $input.thread_id && $db.messages.project_id ==? $input.project_id
      sort = {messages.updated_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $rows
  }

  response = $rows
}
