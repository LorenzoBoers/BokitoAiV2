query "oauth/microsoft/callback" verb=GET {
  api_group = "integrations"

  input {
    text code? filters=trim
    text state? filters=trim
    text error? filters=trim
    text error_description? filters=trim
  }

  stack {
    util.set_header {
      value = "Content-Type: text/html; charset=utf-8"
      duplicates = "replace"
    }

    var $base {
      value = $env.dashboard_outlook_return_url|to_text
    }

    conditional {
      if (($base|strlen) == 0) {
        var.update $base {
          value = "https://app.bokito.ai/settings/support/general"
        }
      }
    }

    var $redirect_url {
      value = $base ~ "?outlook_error=unknown"
    }

    conditional {
      if (($input.error|strlen) > 0) {
        var.update $redirect_url {
          value = $base ~ "?outlook_error=" ~ ($input.error|url_encode_rfc3986)
        }
      }

      elseif (($input.code|strlen) == 0) {
        var.update $redirect_url {
          value = $base ~ "?outlook_error=missing_code"
        }
      }

      elseif (($input.state|strlen) == 0) {
        var.update $redirect_url {
          value = $base ~ "?outlook_error=missing_state"
        }
      }

      else {
        db.query email_outlook_oauth_state {
          where = $db.email_outlook_oauth_state.nonce == $input.state
          return = {type: "list"}
        } as $states

        conditional {
          if (($states|count) == 0) {
            var.update $redirect_url {
              value = $base ~ "?outlook_error=invalid_state"
            }
          }

          else {
            var $st {
              value = $states|first
            }

            conditional {
              if (($st.return_url|to_text|strlen) > 0) {
                var.update $base {
                  value = $st.return_url|to_text
                }
              }
            }

            var.update $redirect_url {
              value = $base ~ "?outlook_error=unknown"
            }

            conditional {
              if ($st.expires_at < now) {
                db.del email_outlook_oauth_state {
                  field_name = "id"
                  field_value = $st.id
                }

                var.update $redirect_url {
                  value = $base ~ "?outlook_error=expired_state"
                }
              }

              else {
                db.del email_outlook_oauth_state {
                  field_name = "id"
                  field_value = $st.id
                }

                api.request {
                  url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
                  method = "POST"
                  params = {}
                    |set:"client_id":($env.MICROSOFT_CLIENT_ID|to_text)
                    |set:"client_secret":($env.MICROSOFT_CLIENT_SECRET|to_text)
                    |set:"grant_type":"authorization_code"
                    |set:"code":($input.code|to_text)
                    |set:"redirect_uri":($env.MICROSOFT_REDIRECT_URI|to_text)
                  headers = []
                    |push:"Content-Type: application/x-www-form-urlencoded"
                  timeout = 60
                } as $tok_res

                var $tr {
                  value = $tok_res.response
                }

                var $aad_err {
                  value = ""
                }

                conditional {
                  if ($tr != null) {
                    var.update $aad_err {
                      value = $tr|get:"error":""
                    }
                  }
                }

                var $aad_desc {
                  value = ""
                }

                conditional {
                  if ($tr != null) {
                    var.update $aad_desc {
                      value = $tr|get:"error_description":""
                    }
                  }
                }

                conditional {
                  if ($tr == null) {
                    var.update $redirect_url {
                      value = $base ~ "?outlook_error=token_exchange"
                    }
                  }

                  elseif (($aad_err|strlen) > 0) {
                    var $aad_detail {
                      value = ($aad_err ~ " " ~ $aad_desc)|trim|url_encode_rfc3986
                    }

                    var.update $redirect_url {
                      value = $base ~ "?outlook_error=microsoft_oauth_token&aad_detail=" ~ $aad_detail
                    }
                  }

                  else {
                    var $at0 {
                      value = $tr|get:"access_token":""
                    }

                    conditional {
                      if (($at0|strlen) == 0) {
                        var.update $redirect_url {
                          value = $base ~ "?outlook_error=token_exchange"
                        }
                      }

                      else {
                        var $rt {
                          value = $tr|get:"refresh_token":""
                        }

                        conditional {
                          if (($rt|strlen) == 0) {
                            var $scope_hint {
                              value = $tr|get:"scope":""
                            }

                            var $nr_detail {
                              value = ("missing_refresh_token scope=" ~ $scope_hint)|url_encode_rfc3986
                            }

                            var.update $redirect_url {
                              value = $base ~ "?outlook_error=no_refresh_token&aad_detail=" ~ $nr_detail
                            }
                          }

                          else {
                            api.request {
                              url = "https://graph.microsoft.com/v1.0/me"
                              method = "GET"
                              headers = []
                                |push:"Authorization: Bearer " ~ $at0
                              timeout = 30
                            } as $me_res

                            var $profile {
                              value = $me_res.response
                            }

                            var $ms_id {
                              value = $profile|get:"id":""
                            }

                            conditional {
                              if ($profile == null) {
                                var.update $redirect_url {
                                  value = $base ~ "?outlook_error=graph_profile"
                                }
                              }

                              elseif (($ms_id|strlen) == 0) {
                                var.update $redirect_url {
                                  value = $base ~ "?outlook_error=no_ms_id"
                                }
                              }

                              else {
                                var $mail_raw {
                                  value = $profile|get:"mail":""
                                }

                                var $upn {
                                  value = $profile|get:"userPrincipalName":""
                                }

                                var $mail {
                                  value = $mail_raw
                                }

                                conditional {
                                  if (($mail|strlen) == 0) {
                                    var.update $mail {
                                      value = $upn
                                    }
                                  }
                                }

                                var $exp_in {
                                  value = $tr|get:"expires_in":3600
                                }

                                var $access_exp {
                                  value = now|add_secs_to_timestamp:($exp_in|to_int)
                                }

                                var $scp {
                                  value = $tr|get:"scope":""
                                }

                                var $dname {
                                  value = $profile|get:"displayName":""
                                }

                                db.query email_oauth_connection {
                                  where = $db.email_oauth_connection.organisation_id == $st.organisation_id && $db.email_oauth_connection.ms_user_id == $ms_id
                                  return = {type: "list"}
                                } as $existing

                                db.query email_oauth_connection {
                                  where = $db.email_oauth_connection.organisation_id == $st.organisation_id && $db.email_oauth_connection.is_primary == true
                                  return = {type: "list"}
                                } as $primary_rows

                                var $make_primary {
                                  value = (($primary_rows|count) == 0)
                                }

                                conditional {
                                  if (($existing|count) > 0) {
                                    var $first_conn {
                                      value = $existing|first
                                    }

                                    db.edit email_oauth_connection {
                                      field_name = "id"
                                      field_value = $first_conn.id
                                      data = {
                                        refresh_token     : $rt
                                        access_expires_at : $access_exp
                                        scopes            : $scp
                                        status            : "active"
                                        mailbox_email     : $mail
                                        display_name      : $dname
                                        last_error        : ""
                                        created_by_user_id: $st.user_id
                                        provider          : "outlook"
                                      }
                                    } as $saved
                                  }

                                  else {
                                    db.add email_oauth_connection {
                                      data = {
                                        organisation_id   : $st.organisation_id
                                        created_by_user_id: $st.user_id
                                        provider          : "outlook"
                                        ms_tenant_id      : ""
                                        ms_user_id        : $ms_id
                                        mailbox_email     : $mail
                                        display_name      : $dname
                                        refresh_token     : $rt
                                        access_expires_at : $access_exp
                                        scopes            : $scp
                                        status            : "active"
                                        is_enabled        : true
                                        is_primary        : $make_primary
                                      }
                                    } as $saved
                                  }
                                }

                                var.update $redirect_url {
                                  value = $base ~ "?outlook=connected"
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
            }
          }
        }
      }
    }

    var $html {
      value = "<!DOCTYPE html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" ~ $redirect_url ~ "\"></head><body><p>Doorverwijzen...</p></body></html>"
    }
  }

  response = $html
}