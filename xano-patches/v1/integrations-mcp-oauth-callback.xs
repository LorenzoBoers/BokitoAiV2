// GET /api:integrations/integrations/mcp/oauth/callback - remote MCP OAuth callback
query "integrations/mcp/oauth/callback" verb=GET {
  api_group = "integrations"
  auth = "false"

  input {
    text code? filters=trim
    text state? filters=trim
    text error?
  }

  stack {
    util.set_header {
      value = "Content-Type: text/html; charset=utf-8"
      duplicates = "replace"
    }

    var $return_url {
      value = "https://app.bokito.ai/integrations/marketplace"
    }

    var $html {
      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
    }

    conditional {
      if ($input.state == null || ($input.state|strlen) == 0) {
        var.update $return_url {
          value = $return_url ~ "?integration_error=missing_state"
        }
      }

      else {
        db.query integration_oauth_states {
          where = $db.integration_oauth_states.id == $input.state && $db.integration_oauth_states.expires_at > now
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $state_rows

        conditional {
          if (($state_rows|count) == 0) {
            var.update $return_url {
              value = $return_url ~ "?integration_error=invalid_state"
            }
          }

          else {
            var $state {
              value = $state_rows|first
            }

            var.update $return_url {
              value = $state.return_url
            }

            conditional {
              if ($input.error != null && ($input.error|strlen) > 0) {
                var.update $return_url {
                  value = $return_url ~ "?integration_error=" ~ ($input.error|url_encode)
                }
              }

              elseif ($input.code == null || ($input.code|strlen) == 0) {
                var.update $return_url {
                  value = $return_url ~ "?integration_error=missing_code"
                }
              }

              else {
                db.query integration_providers {
                  where = $db.integration_providers.slug == $state.provider_slug
                  return = {type: "list", paging: {page: 1, per_page: 1}}
                } as $prov_rows

                var $provider {
                  value = $prov_rows|first
                }

                var $runtime_base {
                  value = $env.RUNTIME_INTERNAL_URL|to_text
                }

                api.request {
                  url = $runtime_base ~ "/internal/mcp/oauth/exchange"
                  method = "POST"
                  params = {}
                  headers = []
                    |push:("Authorization: Bearer " ~ ($env.WORKER_INBOUND_SECRET|to_text))
                    |push:"Content-Type: application/json"
                    |push:"Accept: application/json"
                  body = {
                    code            : $input.code
                    code_verifier   : $state.code_verifier
                    oauth_client_id : $state.oauth_client_id
                    slug            : $provider.slug
                    mcp_remote_url: $provider.mcp_remote_url
                    mcp_transport : $provider.mcp_transport
                    oauth_config_key: $provider.oauth_config_key
                    oauth_profile : $provider.oauth_profile
                  }
                  timeout = 60
                } as $token_res

                var $tokens {
                  value = $token_res.response.result
                }

                var $access_token {
                  value = $tokens.access_token|to_text
                }

                conditional {
                  if (($access_token|strlen) == 0) {
                    var.update $return_url {
                      value = $return_url ~ "?integration_error=token_exchange_failed"
                    }
                  }

                  else {
                    var $ext_id {
                      value = $tokens.external_account_id|to_text
                    }

                    var $display_name {
                      value = $tokens.display_name|to_text
                    }

                    var $credentials {
                      value = {
                        access_token   : $access_token
                        refresh_token  : $tokens.refresh_token
                        token_type     : $tokens.token_type
                        scope          : $tokens.scope
                        mcp_remote_url : $provider.mcp_remote_url
                      }
                    }

                    var $metadata {
                      value = $tokens.metadata
                    }

                    db.query integration_connections {
                      where = $db.integration_connections.tenant_id == $state.tenant_id && $db.integration_connections.provider_id == $provider.id && $db.integration_connections.external_account_id == $ext_id
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $existing_ic

                    security.create_uuid as $new_ic_id

                    var $conn_id {
                      value = $new_ic_id
                    }

                    conditional {
                      if (($existing_ic|count) > 0) {
                        var.update $conn_id {
                          value = ($existing_ic|first).id
                        }

                        db.edit integration_connections {
                          field_name = "id"
                          field_value = $conn_id
                          data = {
                            display_name        : $display_name
                            credentials         : $credentials
                            status              : "active"
                            connected_by_user_id: $state.user_id
                            metadata            : $metadata
                            updated_at          : now
                          }
                        } as $ic
                      }

                      else {
                        db.add integration_connections {
                          data = {
                            id                  : $conn_id
                            tenant_id           : $state.tenant_id
                            provider_id         : $provider.id
                            external_account_id : $ext_id
                            display_name        : $display_name
                            credentials         : $credentials
                            status              : "active"
                            connected_by_user_id: $state.user_id
                            metadata            : $metadata
                            created_at          : now
                            updated_at          : now
                          }
                        } as $ic
                      }
                    }

                    db.query integration_bindings {
                      where = $db.integration_bindings.connection_id == $conn_id && $db.integration_bindings.binding_type == "mcp_server" && $db.integration_bindings.status == "active"
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $existing_binding

                    conditional {
                      if (($existing_binding|count) == 0) {
                        security.create_uuid as $binding_id

                        db.add integration_bindings {
                          data = {
                            id            : $binding_id
                            tenant_id     : $state.tenant_id
                            connection_id : $conn_id
                            binding_type  : "mcp_server"
                            project_id    : null
                            config        : {
                              mode          : "remote_oauth"
                              provider      : $provider.slug
                              mcp_remote_url: $provider.mcp_remote_url
                              transport     : $provider.mcp_transport
                            }
                            status        : "active"
                            created_at    : now
                            updated_at    : now
                          }
                        } as $binding
                      }
                    }

                    db.del integration_oauth_states {
                      field_name = "id"
                      field_value = $state.id
                    }

                    var.update $return_url {
                      value = $return_url ~ "?integration=connected&provider=" ~ ($state.provider_slug|url_encode)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    var.update $html {
      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
    }
  }

  response = $html
}
