// PATCH /api:workforce/projects/{project_id}/repo - link GitHub repo to project
query "projects/{project_id}/repo" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text repo_full_name? filters=trim
    text github_repo_full_name? filters=trim
    text default_branch? filters=trim
    text github_default_branch? filters=trim
    uuid connection_id?
    uuid github_connection_id?
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

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $repo_name {
      value = $input.repo_full_name != null && ($input.repo_full_name|strlen) > 0 ? $input.repo_full_name : $input.github_repo_full_name
    }

    precondition ($repo_name != null && ($repo_name|strlen) > 0) {
      error_type = "inputerror"
      error = "repo_full_name is required."
    }

    var $branch {
      value = "main"
    }

    conditional {
      if ($input.default_branch != null && ($input.default_branch|strlen) > 0) {
        var.update $branch {
          value = $input.default_branch
        }
      }

      elseif ($input.github_default_branch != null && ($input.github_default_branch|strlen) > 0) {
        var.update $branch {
          value = $input.github_default_branch
        }
      }
    }

    var $conn_id {
      value = $input.connection_id != null ? $input.connection_id : $input.github_connection_id
    }

    var $gh_conn {
      value = null
    }

    var $ic_conn {
      value = null
    }

    conditional {
      if ($conn_id != null) {
        db.get integration_connections {
          field_name = "id"
          field_value = $conn_id
        } as $ic

        conditional {
          if ($ic != null && $ic.tenant_id == $me.organisation_id && $ic.status == "active") {
            var.update $ic_conn {
              value = $ic
            }
          }
        }

        db.get github_connections {
          field_name = "id"
          field_value = $conn_id
        } as $gh

        conditional {
          if ($gh != null && $gh.tenant_id == $me.organisation_id && $gh.status == "active") {
            var.update $gh_conn {
              value = $gh
            }
          }
        }
      }
    }

    conditional {
      if ($ic_conn == null && $gh_conn == null) {
        db.query integration_providers {
          where = $db.integration_providers.slug == "github"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $prov_rows

        conditional {
          if (($prov_rows|count) > 0) {
            db.query integration_connections {
              where = $db.integration_connections.tenant_id == $me.organisation_id && $db.integration_connections.provider_id == ($prov_rows|first).id && $db.integration_connections.status == "active"
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $ic_rows

            conditional {
              if (($ic_rows|count) > 0) {
                var.update $ic_conn {
                  value = $ic_rows|first
                }

                var.update $conn_id {
                  value = ($ic_rows|first).id
                }
              }
            }
          }
        }

        conditional {
          if ($ic_conn == null) {
            db.query github_connections {
              where = $db.github_connections.tenant_id == $me.organisation_id && $db.github_connections.status == "active"
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $conn_rows

            precondition (($conn_rows|count) > 0) {
              error_type = "inputerror"
              error = "Connect GitHub first."
            }

            var.update $gh_conn {
              value = $conn_rows|first
            }

            var.update $conn_id {
              value = ($conn_rows|first).id
            }
          }
        }
      }
    }

    precondition ($ic_conn != null || $gh_conn != null) {
      error_type = "inputerror"
      error = "Connect GitHub first."
    }

    security.create_uuid as $binding_id

    var $binding_conn_id {
      value = $ic_conn != null ? $ic_conn.id : $gh_conn.id
    }

    db.add integration_bindings {
      data = {
        id            : $binding_id
        tenant_id     : $me.organisation_id
        connection_id : $binding_conn_id
        binding_type  : "project_repo"
        project_id    : $input.project_id
        config        : {repo_full_name: $repo_name, default_branch: $branch}
        status        : "active"
        created_at    : now
        updated_at    : now
      }
    } as $binding

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {
        github_connection_id   : $gh_conn != null ? $gh_conn.id : null
        repo_binding_id        : $binding_id
        github_repo_full_name  : $repo_name
        github_default_branch  : $branch
        repo_source            : "github_oauth"
        repo_connected_at      : now
        repo_index_status      : "pending"
        repo_index_error       : null
        repo_indexed_at        : null
        updated_at             : now
      }
    } as $updated
  }

  response = $updated
}
