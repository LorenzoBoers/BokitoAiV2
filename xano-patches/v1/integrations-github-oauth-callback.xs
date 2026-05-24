// GET /api:integrations/github/oauth/callback - exchange code and store connection
query "github/oauth/callback" verb=GET {
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
      value = "https://app.bokito.ai/projects"
    }

  var $html {
      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
    }

    conditional {
      if ($input.state == null || ($input.state|strlen) == 0) {
        var.update $return_url {
          value = $return_url ~ "?github_error=missing_state"
        }

        var.update $html {
          value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
        }
      }

      else {
        db.query github_oauth_states {
          where = $db.github_oauth_states.id == $input.state && $db.github_oauth_states.expires_at > now
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $state_rows

        conditional {
          if (($state_rows|count) == 0) {
            var.update $return_url {
              value = $return_url ~ "?github_error=invalid_state"
            }

            var.update $html {
              value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
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
                  value = $return_url ~ "?github_error=" ~ ($input.error|url_encode)
                }

                var.update $html {
                  value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
                }
              }

              elseif ($input.code == null || ($input.code|strlen) == 0) {
                var.update $return_url {
                  value = $return_url ~ "?github_error=missing_code"
                }

                var.update $html {
                  value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
                }
              }

              else {
                api.request {
                  url = "https://github.com/login/oauth/access_token"
                  method = "POST"
                  headers = [{name: "Accept", value: "application/json"}, {name: "Content-Type", value: "application/json"}]
                  params = {}
                  body = {
                    client_id    : $env.GITHUB_OAUTH_CLIENT_ID
                    client_secret: $env.GITHUB_OAUTH_CLIENT_SECRET
                    code         : $input.code
                    redirect_uri : $env.GITHUB_OAUTH_CALLBACK_URL
                  }
                } as $token_res

                var $access_token {
                  value = $token_res.response.result.access_token|to_text
                }

                conditional {
                  if (($access_token|strlen) == 0) {
                    var.update $return_url {
                      value = $return_url ~ "?github_error=token_exchange_failed"
                    }

                    var.update $html {
                      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
                    }
                  }

                  else {
                    api.request {
                      url = "https://api.github.com/user"
                      method = "GET"
                      headers = [{name: "Authorization", value: "Bearer " ~ $access_token}, {name: "Accept", value: "application/vnd.github+json"}]
                      params = {}
                    } as $user_res

                    var $github_user {
                      value = $user_res.response.result
                    }

                    db.query integration_providers {
                      where = $db.integration_providers.slug == "github"
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $prov_rows

                    var $ext_id {
                      value = $github_user.id|to_text
                    }

                    conditional {
                      if (($prov_rows|count) > 0) {
                        db.query integration_connections {
                          where = $db.integration_connections.tenant_id == $state.tenant_id && $db.integration_connections.provider_id == ($prov_rows|first).id && $db.integration_connections.external_account_id == $ext_id
                          return = {type: "list", paging: {page: 1, per_page: 1}}
                        } as $existing_ic

                        conditional {
                          if (($existing_ic|count) > 0) {
                            db.edit integration_connections {
                              field_name = "id"
                              field_value = ($existing_ic|first).id
                              data = {
                                display_name        : $github_user.login
                                credentials         : {access_token: $access_token}
                                status              : "active"
                                connected_by_user_id: $state.user_id
                                metadata            : {scopes: "read:user repo", github_login: $github_user.login}
                                updated_at          : now
                              }
                            } as $ic
                          }

                          else {
                            security.create_uuid as $ic_id

                            db.add integration_connections {
                              data = {
                                id                  : $ic_id
                                tenant_id           : $state.tenant_id
                                provider_id         : ($prov_rows|first).id
                                external_account_id : $ext_id
                                display_name        : $github_user.login
                                credentials         : {access_token: $access_token}
                                status              : "active"
                                connected_by_user_id: $state.user_id
                                metadata            : {scopes: "read:user repo", github_login: $github_user.login}
                                created_at          : now
                                updated_at          : now
                              }
                            } as $ic
                          }
                        }
                      }
                    }

                    db.query github_connections {
                      where = $db.github_connections.tenant_id == $state.tenant_id && $db.github_connections.github_user_id == $github_user.id
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $existing

                    conditional {
                      if (($existing|count) > 0) {
                        db.edit github_connections {
                          field_name = "id"
                          field_value = ($existing|first).id
                          data = {
                            connected_by_user_id: $state.user_id
                            github_user_id      : $github_user.id
                            github_login        : $github_user.login
                            access_token        : $access_token
                            scopes              : "read:user repo"
                            status              : "active"
                            updated_at          : now
                          }
                        } as $conn
                      }

                      else {
                        security.create_uuid as $conn_id

                        db.add github_connections {
                          data = {
                            id                  : $conn_id
                            tenant_id           : $state.tenant_id
                            connected_by_user_id: $state.user_id
                            github_user_id      : $github_user.id
                            github_login        : $github_user.login
                            access_token        : $access_token
                            refresh_token       : null
                            token_expires_at    : null
                            scopes              : "read:user repo"
                            status              : "active"
                            created_at          : now
                            updated_at          : now
                          }
                        } as $conn
                      }
                    }

                    db.del integration_oauth_states {
                      field_name = "id"
                      field_value = $state.id
                    }

                    db.del github_oauth_states {
                      field_name = "id"
                      field_value = $state.id
                    }

                    var.update $return_url {
                      value = $return_url ~ "?github=connected"
                    }

                    var.update $html {
                      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = $html
}
