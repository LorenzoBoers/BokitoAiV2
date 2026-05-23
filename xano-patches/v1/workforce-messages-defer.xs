// POST /api:workforce/messages/{message_id}/defer - user JWT, snooze 7 days
query "messages/{message_id}/defer" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid message_id
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    db.query messages {
      where = $db.messages.id == $input.message_id && $db.messages.tenant_id == $me.organisation_id
      return = {type: "list"}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Message not found."
    }

    db.edit messages {
      field_name = "id"
      field_value = $input.message_id
      data = {resolved_at: now|add_days_to_timestamp:7, updated_at: now}
    } as $updated
  }

  response = {ok: true, message_id: $input.message_id}
}
