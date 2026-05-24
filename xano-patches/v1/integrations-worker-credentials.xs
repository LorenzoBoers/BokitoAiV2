// POST /api:integrations/integrations/worker/credentials - worker fetch tokens for a connection or project repo
query "integrations/worker/credentials" verb=POST {
  api_group = "integrations"
  auth = "false"

  input {
    uuid tenant_id
    uuid project_id?
    uuid connection_id?
    text purpose? filters=trim
    text worker_secret filters=trim
  }

  stack {
    precondition ($input.worker_secret == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Invalid worker secret."
    }

    var $conn {
      value = null
    }

    var $repo_full_name {
      value = null
    }

    var $default_branch {
      value = "main"
    }

    conditional {
      if ($input.connection_id != null) {
        db.get integration_connections {
          field_name = "id"
          field_value = $input.connection_id
        } as $direct

        precondition ($direct != null && $direct.tenant_id == $input.tenant_id && $direct.status == "active") {
          error_type = "inputerror"
          error = "Connection not found."
        }

        var.update $conn {
          value = $direct
        }
      }

      elseif ($input.project_id != null) {
        db.query projects {
          where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $input.tenant_id
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $proj_rows

        precondition (($proj_rows|count) > 0) {
          error_type = "inputerror"
          error = "Project not found."
        }

        var $project {
          value = $proj_rows|first
        }

        var.update $repo_full_name {
          value = $project.github_repo_full_name
        }

        var.update $default_branch {
          value = $project.github_default_branch != null ? $project.github_default_branch : "main"
        }

        conditional {
          if ($project.repo_binding_id != null) {
            db.get integration_bindings {
              field_name = "id"
              field_value = $project.repo_binding_id
            } as $binding

            conditional {
              if ($binding != null && $binding.status == "active") {
                var.update $repo_full_name {
                  value = $binding.config.repo_full_name
                }

                var.update $default_branch {
                  value = $binding.config.default_branch != null ? $binding.config.default_branch : "main"
                }

                db.get integration_connections {
                  field_name = "id"
                  field_value = $binding.connection_id
                } as $binding_conn

                var.update $conn {
                  value = $binding_conn
                }
              }
            }
          }
        }

        conditional {
          if ($conn == null && $project.github_connection_id != null) {
            db.get github_connections {
              field_name = "id"
              field_value = $project.github_connection_id
            } as $gh

            conditional {
              if ($gh != null && $gh.status == "active") {
                var $ic_from_gh {
                  value = {
                    credentials: {access_token: $gh.access_token}
                    status     : $gh.status
                  }
                }

                var.update $conn {
                  value = $ic_from_gh
                }
              }
            }
          }
        }

        conditional {
          if ($conn == null) {
            db.query integration_connections {
              where = $db.integration_connections.tenant_id == $input.tenant_id && $db.integration_connections.status == "active"
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $ic_rows

            conditional {
              if (($ic_rows|count) > 0) {
                db.query integration_providers {
                  where = $db.integration_providers.id == ($ic_rows|first).provider_id && $db.integration_providers.slug == "github"
                  return = {type: "list", paging: {page: 1, per_page: 1}}
                } as $gh_prov

                conditional {
                  if (($gh_prov|count) > 0) {
                    var.update $conn {
                      value = $ic_rows|first
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    precondition ($conn != null) {
      error_type = "inputerror"
      error = "No active connection."
    }

    var $access_token {
      value = $conn.credentials.access_token|to_text
    }

    conditional {
      if (($access_token|strlen) == 0 && $conn.access_token != null) {
        var.update $access_token {
          value = $conn.access_token|to_text
        }
      }
    }

    precondition (($access_token|strlen) > 0) {
      error_type = "inputerror"
      error = "Missing access token."
    }
  }

  response = {
    access_token         : $access_token
    github_repo_full_name: $repo_full_name
    github_default_branch: $default_branch
    connection_id        : $conn.id
  }
}
