// GET /api:integrations/integrations/oauth/callback - generic OAuth callback (github)
query "integrations/oauth/callback" verb=GET {
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
      value = "https://app.bokito.ai/settings/integrations"
    }

    var $html {
      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $return_url ~ "\"></head><body><p>Redirecting...</p></body></html>"
    }

    var $query_flag {
      value = "integration"
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
            db.query github_oauth_states {
              where = $db.github_oauth_states.id == $input.state && $db.github_oauth_states.expires_at > now
              return = {type: "list", paging: {page: 1, per_page: 1}}
            } as $legacy_rows

            conditional {
              if (($legacy_rows|count) > 0) {
                var $legacy {
                  value = $legacy_rows|first
                }

                var.update $return_url {
                  value = $legacy.return_url
                }

                var $legacy_provider {
                  value = "github"
                }
              }
            }
          }

          else {
            var $state {
              value = $state_rows|first
            }

            var.update $return_url {
              value = $state.return_url
            }

            var $legacy_provider {
              value = $state.provider_slug
            }
          }
        }

        conditional {
          if ($legacy_provider == null) {
            var.update $return_url {
              value = $return_url ~ "?integration_error=invalid_state"
            }
          }

          elseif ($input.error != null && ($input.error|strlen) > 0) {
            var.update $return_url {
              value = $return_url ~ "?integration_error=" ~ ($input.error|url_encode)
            }
          }

          elseif ($input.code == null || ($input.code|strlen) == 0) {
            var.update $return_url {
              value = $return_url ~ "?integration_error=missing_code"
            }
          }

          elseif ($legacy_provider == "github") {
            var $state {
              value = ($state_rows|count) > 0 ? ($state_rows|first) : ($legacy_rows|first)
            }

            api.request {
              url = "https://github.com/login/oauth/access_token"
              method = "POST"
              params = {}
                |set:"client_id":($env.GITHUB_OAUTH_CLIENT_ID|to_text)
                |set:"client_secret":($env.GITHUB_OAUTH_CLIENT_SECRET|to_text)
                |set:"code":($input.code|to_text)
                |set:"redirect_uri":($env.GITHUB_OAUTH_CALLBACK_URL|to_text)
              headers = []
                |push:"Accept: application/json"
                |push:"Content-Type: application/x-www-form-urlencoded"
              timeout = 60
            } as $token_res

            var $access_token {
              value = $token_res.response.result.access_token|to_text
            }

            conditional {
              if (($access_token|strlen) == 0) {
                var.update $return_url {
                  value = $return_url ~ "?integration_error=token_exchange_failed"
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

                var $provider_id {
                  value = ($prov_rows|first).id
                }

                var $ext_id {
                  value = $github_user.id|to_text
                }

                db.query integration_connections {
                  where = $db.integration_connections.tenant_id == $state.tenant_id && $db.integration_connections.provider_id == $provider_id && $db.integration_connections.external_account_id == $ext_id
                  return = {type: "list", paging: {page: 1, per_page: 1}}
                } as $existing_ic

                security.create_uuid as $new_ic_id

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
                    db.add integration_connections {
                      data = {
                        id                  : $new_ic_id
                        tenant_id           : $state.tenant_id
                        provider_id         : $provider_id
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

                db.query github_connections {
                  where = $db.github_connections.tenant_id == $state.tenant_id && $db.github_connections.github_user_id == $github_user.id
                  return = {type: "list", paging: {page: 1, per_page: 1}}
                } as $existing_gh

                conditional {
                  if (($existing_gh|count) > 0) {
                    db.edit github_connections {
                      field_name = "id"
                      field_value = ($existing_gh|first).id
                      data = {
                        connected_by_user_id: $state.user_id
                        github_login        : $github_user.login
                        access_token        : $access_token
                        scopes              : "read:user repo"
                        status              : "active"
                        updated_at          : now
                      }
                    } as $gh
                  }

                  else {
                    security.create_uuid as $gh_id

                    db.add github_connections {
                      data = {
                        id                  : $gh_id
                        tenant_id           : $state.tenant_id
                        connected_by_user_id: $state.user_id
                        github_user_id      : $github_user.id
                        github_login        : $github_user.login
                        access_token        : $access_token
                        scopes              : "read:user repo"
                        status              : "active"
                        created_at          : now
                        updated_at          : now
                      }
                    } as $gh
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
                  value = $return_url ~ "?integration=connected&provider=github"
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
