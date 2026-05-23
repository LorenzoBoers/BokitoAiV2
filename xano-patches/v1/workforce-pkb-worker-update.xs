// POST /api:workforce/pkb/worker/update - worker / run token auth.
// Updates a single pkb_sections row: any combination of content, title,
// change_status, priority. Used by the PO agent's update_pkb_section tool.
query "pkb/worker/update" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid section_id
    text content?
    text title?
    text change_status?
    int priority?
  }

  stack {
    var $worker_ok {
      value = $input.worker_api_key != null && ($input.worker_api_key|strlen) > 0 && $input.worker_api_key == $env.XANO_WORKER_API_KEY
    }

    var $run_ok {
      value = $input.auth_token != null && ($input.auth_token|strlen) > 0
    }

    precondition ($worker_ok || $run_ok) {
      error_type = "accessdenied"
      error = "Unauthorized."
    }

    db.query pkb_sections {
      where = $db.pkb_sections.id == $input.section_id
      return = {type: "list"}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Section not found."
    }

    var $existing {
      value = $rows|first
    }

    db.edit pkb_sections {
      field_name = "id"
      field_value = $input.section_id
      data = {
        content      : ($input.content != null) ? $input.content : $existing.content
        title        : ($input.title != null) ? $input.title : $existing.title
        change_status: ($input.change_status != null) ? $input.change_status : $existing.change_status
        priority     : ($input.priority != null) ? $input.priority : $existing.priority
        updated_at   : now
      }
    } as $section
  }

  response = $section
}
