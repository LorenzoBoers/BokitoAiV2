// POST /api:workforce/projects/{project_id}/doc/pages/{page_id}/blocks
// Accepts an array of ops to apply atomically: create, update, delete, move.
// Each successful op writes a doc_block_revisions row for audit. After all
// ops apply, the page is queued for reindexing into index_chunks via the
// runtime worker (POST {WORKER_BASE_URL}/doc/reindex-page).
//
// Op shape:
//   { op: "create", id?, parent_block_id?, type, text, props, position }
//   { op: "update", id, type?, text?, props? }
//   { op: "delete", id }
//   { op: "move",   id, parent_block_id?, position }
query "projects/{project_id}/doc/pages/{page_id}/blocks" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    uuid page_id
    object[] ops
    text actor_label?
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

    precondition ($page.is_locked == false) {
      error_type = "accessdenied"
      error = "Page is locked. Unlock it before editing."
    }

    var $actor_label {
      value = $input.actor_label != null ? $input.actor_label : (($me.first_name|to_string) ~ " " ~ ($me.last_name|to_string))|trim
    }

    conditional {
      if ($actor_label == "") {
        var.update $actor_label {
          value = $me.email|to_string
        }
      }
    }

    var $applied {
      value = []
    }

    foreach ($input.ops as $op) {
      conditional {
        if ($op.op == "create") {
          var $new_id {
            value = $op.id != null ? $op.id : ""|uuid
          }

          var $position {
            value = $op.position != null ? $op.position : 0
          }

          db.add doc_blocks {
            data = {
              id                  : $new_id
              tenant_id           : $me.organisation_id
              project_id          : $input.project_id
              page_id             : $input.page_id
              parent_block_id     : $op.parent_block_id
              type                : $op.type
              text                : $op.text != null ? $op.text : []
              props               : $op.props != null ? $op.props : {}
              position            : $position
              created_by_type     : "user"
              created_by_id       : $me.id|to_string
              last_edited_by_type : "user"
              last_edited_by_id   : $me.id|to_string
              created_at          : now
              updated_at          : now
            }
          } as $created

          db.add doc_block_revisions {
            data = {
              id          : ""|uuid
              tenant_id   : $me.organisation_id
              project_id  : $input.project_id
              page_id     : $input.page_id
              block_id    : $new_id
              op          : "create"
              before      : null
              after       : $created
              actor_type  : "user"
              actor_id    : $me.id|to_string
              actor_label : $actor_label
              change_note : $op.change_note
              created_at  : now
            }
          }

          var.update $applied {
            value = $applied|push:$created
          }
        }

        elseif ($op.op == "update") {
          db.query doc_blocks {
            where = $db.doc_blocks.id == $op.id && $db.doc_blocks.page_id == $input.page_id
            return = {type: "list", paging: {page: 1, per_page: 1}}
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              var $patch {
                value = {
                  last_edited_by_type: "user"
                  last_edited_by_id  : $me.id|to_string
                  updated_at         : now
                }
              }

              conditional {
                if ($op.type != null) {
                  var.update $patch {
                    value = $patch|set:"type":$op.type
                  }
                }
              }

              conditional {
                if ($op.text != null) {
                  var.update $patch {
                    value = $patch|set:"text":$op.text
                  }
                }
              }

              conditional {
                if ($op.props != null) {
                  var.update $patch {
                    value = $patch|set:"props":$op.props
                  }
                }
              }

              db.edit doc_blocks {
                field_name = "id"
                field_value = $op.id
                data = $patch
              } as $updated

              db.add doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  project_id  : $input.project_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "update"
                  before      : $existing
                  after       : $updated
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
                  actor_label : $actor_label
                  change_note : $op.change_note
                  created_at  : now
                }
              }

              var.update $applied {
                value = $applied|push:$updated
              }
            }
          }
        }

        elseif ($op.op == "move") {
          db.query doc_blocks {
            where = $db.doc_blocks.id == $op.id && $db.doc_blocks.page_id == $input.page_id
            return = {type: "list", paging: {page: 1, per_page: 1}}
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              db.edit doc_blocks {
                field_name = "id"
                field_value = $op.id
                data = {
                  parent_block_id    : $op.parent_block_id
                  position           : $op.position != null ? $op.position : $existing.position
                  last_edited_by_type: "user"
                  last_edited_by_id  : $me.id|to_string
                  updated_at         : now
                }
              } as $moved

              db.add doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  project_id  : $input.project_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "move"
                  before      : $existing
                  after       : $moved
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
                  actor_label : $actor_label
                  change_note : $op.change_note
                  created_at  : now
                }
              }

              var.update $applied {
                value = $applied|push:$moved
              }
            }
          }
        }

        elseif ($op.op == "delete") {
          db.query doc_blocks {
            where = $db.doc_blocks.id == $op.id && $db.doc_blocks.page_id == $input.page_id
            return = {type: "list", paging: {page: 1, per_page: 1}}
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              db.delete doc_blocks {
                field_name = "id"
                field_value = $op.id
              }

              db.add doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  project_id  : $input.project_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "delete"
                  before      : $existing
                  after       : null
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
                  actor_label : $actor_label
                  change_note : $op.change_note
                  created_at  : now
                }
              }
            }
          }
        }
      }
    }

    db.edit doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {updated_at: now}
    }

    api.request {
      url = $env.WORKER_BASE_URL ~ "/doc/reindex-page"
      method = "POST"
      params = {
        project_id: $input.project_id
        tenant_id : $me.organisation_id
        page_id   : $input.page_id
      }
      headers = [
        "Content-Type: application/json"
        ("Authorization: Bearer " ~ $env.WORKER_INBOUND_SECRET)
      ]
      timeout = 5
    } as $reindex_dispatch
  }

  response = {
    applied: $applied
    page_id: $input.page_id
  }
}
