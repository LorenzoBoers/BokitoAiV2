// PATCH /api:workforce/workspace/doc/pages/{page_id}
// Rename, reorder (move), pin, lock, change icon or kind.
query "workspace/doc/pages/{page_id}" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid page_id
    text title? filters=trim
    text kind?
    text icon?
    uuid parent_page_id?
    int position?
    bool is_pinned?
    enum lock_action? {
      values = ["lock", "unlock"]
    }
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

    db.get workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
    } as $page

    precondition ($page != null && $page.tenant_id == $me.organisation_id) {
      error_type = "inputerror"
      error = "Page not found."
    }

    var $next_locked {
      value = $page|get:"is_locked" == true
    }

    conditional {
      if ($input.lock_action == "lock") {
        var.update $next_locked {
          value = true
        }
      }
    }

    conditional {
      if ($input.lock_action == "unlock") {
        var.update $next_locked {
          value = false
        }
      }
    }

    db.edit workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {
        title         : $input.title != null && ($input.title|strlen) > 0 ? $input.title : ($page|get:"title")
        kind          : $input.kind != null ? $input.kind : ($page|get:"kind")
        icon          : $input.icon != null ? $input.icon : ($page|get:"icon")
        parent_page_id: $input.parent_page_id != null ? $input.parent_page_id : ($page|get:"parent_page_id")
        position      : $input.position != null ? $input.position : ($page|get:"position")
        is_pinned     : $input.is_pinned != null ? $input.is_pinned : ($page|get:"is_pinned")
        is_locked     : $next_locked
        updated_at    : now
      }
    } as $updated
  }

  response = $updated
}
