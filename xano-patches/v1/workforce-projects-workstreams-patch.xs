// PATCH /api:workforce/projects/{project_id}/workstreams/{workstream_id}
query "projects/{project_id}/workstreams/{workstream_id}" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    uuid workstream_id
    text name?
    text slug?
    enum status? {
      values = ["active", "draft", "paused"]
    }
    text trigger_text?
    text output_text?
    json steps?
    int position?
    timestamp last_active_at?
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

    db.query project_workstreams {
      where = $db.project_workstreams.id == $input.workstream_id && $db.project_workstreams.project_id == $input.project_id && $db.project_workstreams.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Workstream not found."
    }

    var $updated {
      value = $rows|first
    }

    conditional {
      if ($input.name != null && ($input.name|strlen) > 0) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {name: $input.name, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.slug != null && ($input.slug|strlen) > 0) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {slug: $input.slug, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.status != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {status: $input.status, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.trigger_text != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {trigger_text: $input.trigger_text, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.output_text != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {output_text: $input.output_text, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.steps != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {steps: $input.steps, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.position != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {position: $input.position, updated_at: now}
        } as $updated
      }
    }

    conditional {
      if ($input.last_active_at != null) {
        db.edit project_workstreams {
          field_name = "id"
          field_value = $input.workstream_id
          data = {last_active_at: $input.last_active_at, updated_at: now}
        } as $updated
      }
    }
  }

  response = $updated
}
