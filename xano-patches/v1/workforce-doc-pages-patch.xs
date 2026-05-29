// PATCH /api:workforce/projects/{project_id}/doc/pages/{page_id}
// Rename, reorder (move), pin, lock, change icon or kind.
query "projects/{project_id}/doc/pages/{page_id}" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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

    db.query doc_pages {
      where = $db.doc_pages.id == $input.page_id && $db.doc_pages.project_id == $input.project_id && $db.doc_pages.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    var $page {
      value = $page_rows|first
    }

    var $patch {
      value = {updated_at: now}
    }

    conditional {
      if ($input.title != null && ($input.title|strlen) > 0) {
        var.update $patch {
          value = $patch|set:"title":$input.title
        }
      }
    }

    conditional {
      if ($input.kind != null) {
        var.update $patch {
          value = $patch|set:"kind":$input.kind
        }
      }
    }

    conditional {
      if ($input.icon != null) {
        var.update $patch {
          value = $patch|set:"icon":$input.icon
        }
      }
    }

    conditional {
      if ($input.parent_page_id != null) {
        var.update $patch {
          value = $patch|set:"parent_page_id":$input.parent_page_id
        }
      }
    }

    conditional {
      if ($input.position != null) {
        var.update $patch {
          value = $patch|set:"position":$input.position
        }
      }
    }

    conditional {
      if ($input.is_pinned != null) {
        var.update $patch {
          value = $patch|set:"is_pinned":$input.is_pinned
        }
      }
    }

    conditional {
      if ($input.lock_action == "lock") {
        var.update $patch {
          value = $patch|set:"is_locked":true
        }
      }
    }

    conditional {
      if ($input.lock_action == "unlock") {
        var.update $patch {
          value = $patch|set:"is_locked":false
        }
      }
    }

    db.edit doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = $patch
    } as $updated
  }

  response = $updated
}
