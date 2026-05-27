// POST /api:workforce/workspace/doc/pages
// Create a page under the tenant workspace doc. Slug must be supplied by the
// client (see slugifyPageTitle in the dashboard). Pass workspace_doc_id from
// GET /workspace/doc (workspace_doc.id).
query "workspace/doc/pages" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid workspace_doc_id
    text title filters=trim|min:1
    text slug filters=trim|min:1
    text kind?
    text icon?
    uuid parent_page_id?
    int position?
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

    var $slug {
      value = $input.slug
    }

    var $position {
      value = $input.position != null ? $input.position : 0
    }

    var $page_id {
      value = ""|uuid
    }

    db.add workspace_doc_pages {
      data = {
        id              : $page_id
        tenant_id       : $me.organisation_id
        workspace_doc_id: $input.workspace_doc_id
        parent_page_id  : null
        title           : $input.title
        slug            : $slug
        kind            : $input.kind != null ? $input.kind : "custom"
        icon            : $input.icon != null ? $input.icon : null
        is_pinned       : false
        is_locked       : false
        position        : $position
        archived_at     : null
        updated_at      : now
      }
    } as $page

    conditional {
      if ($input.parent_page_id != null) {
        db.edit workspace_doc_pages {
          field_name = "id"
          field_value = $page_id
          data = {parent_page_id: $input.parent_page_id}
        } as $page
      }
    }
  }

  response = $page
}
