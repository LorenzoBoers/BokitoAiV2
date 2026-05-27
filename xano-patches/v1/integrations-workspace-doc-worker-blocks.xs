// POST /api:integrations/workspace/doc/worker/blocks
// Worker-authenticated batch block ops for an agent. Identical op shape as
// the user-facing batch endpoint, but every revision is recorded with
// actor_type = "agent" and a required change_note. After the batch, the
// page reindex is enqueued on the worker.
query "workspace/doc/worker/blocks" verb=POST {
  api_group = "integrations"
  auth = "none"

  input {
    text token
    uuid workspace_doc_id
    uuid tenant_id
    uuid page_id
    uuid agent_id
    text actor_label
    text change_note filters=trim|min:1
    json ops
  }

  stack {
    precondition ($input.token == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Worker token mismatch."
    }

    db.query workspace_doc_pages {
      where = $db.workspace_doc_pages.id == $input.page_id && $db.workspace_doc_pages.workspace_doc_id == $input.workspace_doc_id && $db.workspace_doc_pages.tenant_id == $input.tenant_id
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
      error = "Page is locked. Agent writes are not allowed on this page."
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

          db.add workspace_doc_blocks {
            data = {
              id                  : $new_id
              tenant_id           : $input.tenant_id
              workspace_doc_id          : $input.workspace_doc_id
              page_id             : $input.page_id
              parent_block_id     : $op.parent_block_id
              block_type          : $op.type
              text                : $op.text != null ? $op.text : []
              props               : $op.props != null ? $op.props : {}
              position            : $op.position != null ? $op.position : 0
              created_by_type     : "agent"
              created_by_id       : $input.agent_id
              last_edited_by_type : "agent"
              last_edited_by_id   : $input.agent_id
              created_at          : now
              updated_at          : now
            }
          } as $created

          db.add workspace_doc_block_revisions {
            data = {
              id          : ""|uuid
              tenant_id   : $input.tenant_id
              workspace_doc_id  : $input.workspace_doc_id
              page_id     : $input.page_id
              block_id    : $new_id
              op          : "create"
              before      : null
              after       : $created
              actor_type  : "agent"
              actor_id    : $input.agent_id
              actor_label : $input.actor_label
              change_note : $input.change_note
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
                  block_type          : $op.type != null ? $op.type : $existing.block_type
                  text                : $op.text != null ? $op.text : $existing.text
                  props               : $op.props != null ? $op.props : $existing.props
                  last_edited_by_type : "agent"
                  last_edited_by_id   : $input.agent_id
                  updated_at          : now
                }
              } as $updated

              db.add workspace_doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $input.tenant_id
                  workspace_doc_id  : $input.workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "update"
                  before      : $existing
                  after       : $updated
                  actor_type  : "agent"
                  actor_id    : $input.agent_id
                  actor_label : $input.actor_label
                  change_note : $input.change_note
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
                  last_edited_by_type: "agent"
                  last_edited_by_id  : $input.agent_id
                  updated_at         : now
                }
              } as $moved

              db.add workspace_doc_block_revisions {
                data = {
                  id          : ""|uuid
                  tenant_id   : $input.tenant_id
                  workspace_doc_id  : $input.workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "move"
                  before      : $existing
                  after       : $moved
                  actor_type  : "agent"
                  actor_id    : $input.agent_id
                  actor_label : $input.actor_label
                  change_note : $input.change_note
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
                  tenant_id   : $input.tenant_id
                  workspace_doc_id  : $input.workspace_doc_id
                  page_id     : $input.page_id
                  block_id    : $op.id
                  op          : "delete"
                  before      : $existing
                  after       : null
                  actor_type  : "agent"
                  actor_id    : $input.agent_id
                  actor_label : $input.actor_label
                  change_note : $input.change_note
                  created_at  : now
                }
              }
            }
          }
        }
      }
      }
    }

    db.edit workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
      data = {updated_at: now}
    }
  }

  response = {
    applied: $applied
    page_id: $input.page_id
  }
}
