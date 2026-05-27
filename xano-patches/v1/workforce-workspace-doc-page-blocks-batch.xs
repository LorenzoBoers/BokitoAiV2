// POST /api:workforce/workspace/doc/pages/{page_id}/blocks
// Accepts an array of ops to apply atomically: create, update, delete, move.
// Each successful op writes a workspace_doc_block_revisions row for audit. After all
// ops apply, the page is queued for reindexing into index_chunks via the
// runtime worker (POST {WORKER_BASE_URL}/workspace/doc/reindex-page).
//
// Op shape:
//   { op: "create", id?, parent_block_id?, type, text, props, position }
//   { op: "update", id, type?, text?, props? }
//   { op: "delete", id }
//   { op: "move",   id, parent_block_id?, position }
query "workspace/doc/pages/{page_id}/blocks" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid page_id
    json ops
    text actor_label?
    int expected_version?
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

    precondition ($page.is_locked == false) {
      error_type = "accessdenied"
      error = "Page is locked. Unlock it before editing."
    }

    var $current_version {
      value = $page.content_version != null ? $page.content_version : 0
    }

    conditional {
      if ($input.expected_version != null && $input.expected_version != $current_version) {
        precondition (false) {
          error_type = "inputerror"
          error = "Content version conflict. Reload the page and retry."
        }
      }
    }

    var $page_workspace_doc_id {
      value = $page|pick:["workspace_doc_id"]|get:"workspace_doc_id"
    }

    var $actor_label {
      value = ($input.actor_label != null ? $input.actor_label : $me.email)|to_string
    }

    var $applied {
      value = []
    }

    foreach ($input.ops) {
      each as $op {
      conditional {
        if ($op.op == "create") {
          var $new_id {
            value = $op.id != null ? $op.id : ""|uuid
          }

          var $position {
            value = $op.position != null ? $op.position : 0
          }

          db.add workspace_doc_blocks {
            data = {
              id                  : $new_id
              tenant_id           : $me.organisation_id
              workspace_doc_id    : $page_workspace_doc_id
              page_id             : $input.page_id
              parent_block_id     : $op.parent_block_id != null ? $op.parent_block_id : null
              block_type          : ($op.type != null ? $op.type : "paragraph")|to_string
              text                : $op.text != null ? $op.text : []
              props               : $op.props != null ? $op.props : {}
              position            : $position
              created_by_type     : "user"
              created_by_id       : $me.id|to_string
              last_edited_by_type : "user"
              last_edited_by_id   : $me.id|to_string
              updated_at          : now
            }
          } as $created

          db.add workspace_doc_block_revisions {
            data = {
              id          : ""|uuid
              tenant_id   : $me.organisation_id
              workspace_doc_id    : $page_workspace_doc_id
              page_id     : $input.page_id
              block_id    : $new_id
              op          : "create"
              before      : null
              after       : $created
              actor_type  : "user"
              actor_id    : $me.id|to_string
              actor_label : $actor_label
              change_note : ""
              created_at  : now
            }
          }

          var.update $applied {
            value = $applied|push:$created
          }
        }
      }

      conditional {
        if ($op.op == "update") {
          db.query workspace_doc_blocks {
            where = $db.workspace_doc_blocks.id == $op.id && $db.workspace_doc_blocks.page_id == $input.page_id
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              db.edit workspace_doc_blocks {
                field_name = "id"
                field_value = $op.id
                data = {
                  block_type          : ($op.type != null ? $op.type : $existing.block_type)|to_string
                  text                : $op.text != null ? $op.text : $existing.text
                  props               : $op.props != null ? $op.props : $existing.props
                  last_edited_by_type : "user"
                  last_edited_by_id   : $me.id|to_string
                  updated_at          : now
                }
              } as $updated

              db.add workspace_doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  workspace_doc_id    : $page_workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "update"
                  before      : $existing
                  after       : $updated
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
              actor_label : $actor_label
                    change_note : ""
                  created_at  : now
                }
              }

              var.update $applied {
                value = $applied|push:$updated
              }
            }
          }
        }
      }

      conditional {
        if ($op.op == "move") {
          db.query workspace_doc_blocks {
            where = $db.workspace_doc_blocks.id == $op.id && $db.workspace_doc_blocks.page_id == $input.page_id
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              db.edit workspace_doc_blocks {
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

              db.add workspace_doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  workspace_doc_id    : $page_workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "move"
                  before      : $existing
                  after       : $moved
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
              actor_label : $actor_label
                    change_note : ""
                  created_at  : now
                }
              }

              var.update $applied {
                value = $applied|push:$moved
              }
            }
          }
        }
      }

      conditional {
        if ($op.op == "delete") {
          db.query workspace_doc_blocks {
            where = $db.workspace_doc_blocks.id == $op.id && $db.workspace_doc_blocks.page_id == $input.page_id
          } as $existing_rows

          conditional {
            if (($existing_rows|count) > 0) {
              var $existing {
                value = $existing_rows|first
              }

              db.del workspace_doc_blocks {
                field_name = "id"
                field_value = $op.id
              }

              db.add workspace_doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $me.organisation_id
                  workspace_doc_id    : $page_workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "delete"
                  before      : $existing
                  after       : null
                  actor_type  : "user"
                  actor_id    : $me.id|to_string
              actor_label : $actor_label
                    change_note : ""
                  created_at  : now
                }
              }
            }
          }
        }
      }
      }
    }

    var $new_version {
      value = $current_version + 1
    }

    db.edit workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {
        content_version: $new_version
        updated_at     : now
      }
    }

    api.request {
      url = $env.WORKER_BASE_URL ~ "/workspace/doc/reindex-page"
      method = "POST"
      params = {
        workspace_doc_id: $page_workspace_doc_id
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
    applied        : $applied
    page_id        : $input.page_id
    content_version: $new_version
  }
}
