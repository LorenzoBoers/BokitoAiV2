// POST /api:workforce/projects/{project_id}/doc/pages
// Create a new page under a project's doc. Optional parent_page_id for
// nesting. Slug is generated from title and kept unique within project.
query "projects/{project_id}/doc/pages" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text title filters=trim|min:1
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

    db.query project_docs {
      where = $db.project_docs.project_id == $input.project_id && $db.project_docs.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $doc_rows

    precondition (($doc_rows|count) > 0) {
      error_type = "inputerror"
      error = "Doc not initialised. GET /projects/{id}/doc first."
    }

    var $doc {
      value = $doc_rows|first
    }

    var $base_slug {
      value = $input.title|lower|preg_replace:/[^a-z0-9]+/:"-"|trim:"-"
    }

    var $slug {
      value = $base_slug == "" ? ("page-" ~ (now|to_string)) : $base_slug
    }

    db.query doc_pages {
      where = $db.doc_pages.project_id == $input.project_id && $db.doc_pages.slug == $slug
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $clash

    conditional {
      if (($clash|count) > 0) {
        var.update $slug {
          value = $slug ~ "-" ~ (now|to_string|substr:0:6)
        }
      }
    }

    var $position {
      value = $input.position != null ? $input.position : 0
    }

    conditional {
      if ($position == 0) {
        db.query doc_pages {
          where = $db.doc_pages.doc_id == $doc.id && $db.doc_pages.parent_page_id ==? $input.parent_page_id
          sort = {doc_pages.position: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $last_sibling

        var.update $position {
          value = ($last_sibling|count) > 0 ? (($last_sibling|first).position + 1) : 0
        }
      }
    }

    security.create_uuid as $page_id

    db.add doc_pages {
      data = {
        id            : $page_id
        tenant_id     : $me.organisation_id
        project_id    : $input.project_id
        doc_id        : $doc.id
        parent_page_id: $input.parent_page_id
        title         : $input.title
        slug          : $slug
        kind          : $input.kind != null ? $input.kind : "custom"
        icon          : $input.icon
        is_pinned     : false
        is_locked     : false
        position      : $position
        archived_at   : null
        created_at    : now
        updated_at    : now
      }
    } as $page
  }

  response = $page
}
