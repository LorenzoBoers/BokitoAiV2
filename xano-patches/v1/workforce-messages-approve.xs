// POST /api:workforce/messages/{message_id}/approve - user JWT
query "messages/{message_id}/approve" verb=POST {
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

    var $msg {
      value = $rows|first
    }

    var $request_id {
      value = $msg.payload != null ? $msg.payload.blueprint_change_request_id : null
    }

    db.edit messages {
      field_name = "id"
      field_value = $input.message_id
      data = {status: "pending_implementation", updated_at: now}
    } as $updated

    conditional {
      if ($request_id != null) {
        db.edit doc_change_requests {
          field_name = "id"
          field_value = $request_id
          data = {status: "in_progress", updated_at: now}
        } as $request
      }
    }
  }

  response = {ok: true, message_id: $input.message_id, status: "pending_implementation"}
}
