// POST /api:workforce/workspace/doc/pages/{page_id}/blocks
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

    db.get workspace_doc_pages {
      field_name = "id"
      field_value = $input.page_id
    } as $page

    precondition ($page != null && $page.tenant_id == $me.organisation_id) {
      error_type = "inputerror"
      error = "Page not found."
    }

    conditional {
      if ($page.is_locked == true) {
        precondition (false) {
          error_type = "accessdenied"
          error = "Page is locked. Unlock it before editing."
        }
      }
    }

    var $page_workspace_doc_id {
      value = $page.workspace_doc_id
    }

    var $actor_label {
      value = $me.email
    }

    conditional {
      if ($input.actor_label != null && ($input.actor_label|strlen) > 0) {
        var.update $actor_label {
          value = $input.actor_label
        }
      }
    }

    var $applied {
      value = []
    }

    foreach ($input.ops) {
      each as $op {
      conditional {
        if ($op.op == "create") {
          var $new_id {
            value = $op.id != null ? $op.id : (""|uuid)
          }

          var $position {
            value = $op.position != null ? $op.position : 0
          }

          var $block_type {
            value = $op.type != null ? $op.type : "paragraph"
          }

          db.add workspace_doc_blocks {
            data = {
              id                  : $new_id
              tenant_id           : $page.tenant_id
              workspace_doc_id    : $page_workspace_doc_id
              page_id             : $input.page_id
              parent_block_id     : $op.parent_block_id != null ? $op.parent_block_id : null
              block_type          : $block_type
              text                : $op.text
              props               : $op.props
              position            : $position
              created_by_type     : "user"
              created_by_id       : $me.id ~ ""
              last_edited_by_type : "user"
              last_edited_by_id   : $me.id ~ ""
              updated_at          : now
            }
          } as $created

          db.add workspace_doc_block_revisions {
            data = {
              id               : ""|uuid
              tenant_id        : $page.tenant_id
              workspace_doc_id : $page_workspace_doc_id
              page_id          : $input.page_id
              block_id         : $new_id
              op               : "create"
              before           : null
              after            : $created
              actor_type       : "user"
              actor_id         : $me.id ~ ""
              actor_label      : $actor_label
              change_note      : ""
              created_at       : now
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

              var $update_type {
                value = $op.type != null ? $op.type : $existing.block_type
              }

              db.edit workspace_doc_blocks {
                field_name = "id"
                field_value = $op.id
                data = {
                  block_type          : $update_type
                  text                : $op.text != null ? $op.text : $existing.text
                  props               : $op.props != null ? $op.props : $existing.props
                  last_edited_by_type : "user"
                  last_edited_by_id   : $me.id ~ ""
                  updated_at          : now
                }
              } as $updated

              db.add workspace_doc_block_revisions {
                data = {
                  id               : ""|uuid
                  tenant_id        : $page.tenant_id
                  workspace_doc_id : $page_workspace_doc_id
                  page_id          : $input.page_id
                  block_id         : $op.id
                  op               : "update"
                  before           : $existing
                  after            : $updated
                  actor_type       : "user"
                  actor_id         : $me.id ~ ""
                  actor_label      : $actor_label
                  change_note      : ""
                  created_at       : now
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
                  parent_block_id     : $op.parent_block_id != null ? $op.parent_block_id : null
                  position            : $op.position != null ? $op.position : $existing.position
                  last_edited_by_type : "user"
                  last_edited_by_id   : $me.id ~ ""
                  updated_at          : now
                }
              } as $moved

              db.add workspace_doc_block_revisions {
                data = {
                  id               : ""|uuid
                  tenant_id        : $page.tenant_id
                  workspace_doc_id : $page_workspace_doc_id
                  page_id          : $input.page_id
                  block_id         : $op.id
                  op               : "move"
                  before           : $existing
                  after            : $moved
                  actor_type       : "user"
                  actor_id         : $me.id ~ ""
                  actor_label      : $actor_label
                  change_note      : ""
                  created_at       : now
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
                  id               : ""|uuid
                  tenant_id        : $page.tenant_id
                  workspace_doc_id : $page_workspace_doc_id
                  page_id          : $input.page_id
                  block_id         : $op.id
                  op               : "delete"
                  before           : $existing
                  after            : null
                  actor_type       : "user"
                  actor_id         : $me.id ~ ""
                  actor_label      : $actor_label
                  change_note      : ""
                  created_at       : now
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
      data = {
        updated_at: now
      }
    }
  }

  response = {
    applied        : $applied
    page_id        : $input.page_id
    content_version: 0
  }
}
