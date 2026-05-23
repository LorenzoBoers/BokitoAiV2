// POST /api:workforce/messages/{message_id}/reject - user JWT
query "messages/{message_id}/reject" verb=POST {
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

    db.edit messages {
      field_name = "id"
      field_value = $input.message_id
      data = {status: "rejected", updated_at: now}
    } as $updated

    conditional {
      if ($msg.pkb_section_id != null) {
        db.edit pkb_sections {
          field_name = "id"
          field_value = $msg.pkb_section_id
          data = {change_status: "rejected", updated_at: now}
        } as $pkb
      }
    }
  }

  response = {ok: true, message_id: $input.message_id, status: "rejected"}
}
