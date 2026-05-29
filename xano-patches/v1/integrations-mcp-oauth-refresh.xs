// POST /api:integrations/integrations/mcp/oauth/refresh - refresh expiring remote MCP tokens (cron or manual)
query "integrations/mcp/oauth/refresh" verb=POST {
  api_group = "integrations"
  auth = "false"

  input {
    text worker_secret? filters=trim
    uuid connection_id?
  }

  stack {
    precondition ($input.worker_secret == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Invalid worker secret."
    }

    var $refreshed {
      value = 0
    }

    var $errors {
      value = []
    }

    conditional {
      if ($input.connection_id != null) {
        db.get integration_connections {
          field_name = "id"
          field_value = $input.connection_id
        } as $single

        var $conn_list {
          value = $single != null ? [$single] : []
        }
      }

      else {
        db.query integration_connections {
          where = $db.integration_connections.status == "active"
          return = {type: "list"}
        } as $all_conns

        var $conn_list {
          value = []
        }

        foreach ($all_conns) {
          each as $c {
            db.get integration_providers {
              field_name = "id"
              field_value = $c.provider_id
            } as $p

            conditional {
              if ($p != null && $p.auth_type == "mcp_remote_oauth" && $c.credentials.refresh_token != null) {
                var.update $conn_list {
                  value = $conn_list|push:$c
                }
              }
            }
          }
        }
      }
    }

    var $runtime_base {
      value = $env.RUNTIME_INTERNAL_URL|to_text
    }

    foreach ($conn_list) {
      each as $conn {
        db.get integration_providers {
          field_name = "id"
          field_value = $conn.provider_id
        } as $provider

        var $refresh_token {
          value = $conn.credentials.refresh_token|to_text
        }

        conditional {
          if (($refresh_token|strlen) > 0 && ($runtime_base|strlen) > 0) {
            api.request {
              url = $runtime_base ~ "/internal/mcp/oauth/refresh"
              method = "POST"
              params = {}
              headers = []
                |push:("Authorization: Bearer " ~ ($env.WORKER_INBOUND_SECRET|to_text))
                |push:"Content-Type: application/json"
              body = {
                refresh_token   : $refresh_token
                slug            : $provider.slug
                mcp_remote_url  : $provider.mcp_remote_url
                mcp_transport   : $provider.mcp_transport
                oauth_config_key: $provider.oauth_config_key
                oauth_profile   : $provider.oauth_profile
              }
              timeout = 60
            } as $refresh_res

            var $tokens {
              value = $refresh_res.response.result
            }

            var $new_access {
              value = $tokens.access_token|to_text
            }

            conditional {
              if (($new_access|strlen) > 0) {
                var $new_creds {
                  value = $conn.credentials|set:"access_token":$new_access|set:"refresh_token":($tokens.refresh_token|to_text)
                }

                db.edit integration_connections {
                  field_name = "id"
                  field_value = $conn.id
                  data = {
                    credentials: $new_creds
                    updated_at : now
                  }
                } as $updated

                var.update $refreshed {
                  value = $refreshed + 1
                }
              }

              else {
                var.update $errors {
                  value = $errors|push:($conn.id|to_text)
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    refreshed: $refreshed
    errors   : $errors
  }
}
