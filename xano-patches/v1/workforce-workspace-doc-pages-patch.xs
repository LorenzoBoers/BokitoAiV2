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
    bool is_locked?
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

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $page_rows

    precondition (($page_rows|count) > 0) {
      error_type = "inputerror"
      error = "Page not found."
    }

    var $page {
      value = $page_rows|first
    }

    db.edit workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {
        title         : $input.title != null && ($input.title|strlen) > 0 ? $input.title : $page.title
        kind          : $input.kind != null ? $input.kind : $page.kind
        icon          : $input.icon != null ? $input.icon : $page.icon
        parent_page_id: $input.parent_page_id != null ? $input.parent_page_id : $page.parent_page_id
        position      : $input.position != null ? $input.position : $page.position
        is_pinned     : $input.is_pinned != null ? $input.is_pinned : $page.is_pinned
        is_locked     : $input.is_locked != null ? $input.is_locked : $page.is_locked
        updated_at    : now
      }
    } as $updated
  }

  response = $updated
}
