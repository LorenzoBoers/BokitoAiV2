query "oauth/google/callback" verb=GET {
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
      value = $env.dashboard_google_return_url|to_text
    }

    conditional {
      if (($base|strlen) == 0) {
        var.update $base {
          value = $env.dashboard_outlook_return_url|to_text
        }
      }
    }

    conditional {
      if (($base|strlen) == 0) {
        var.update $base {
          value = "https://app.bokito.ai/settings/inbox"
        }
      }
    }

    var $redirect_url {
      value = $base ~ "?oauth_provider=gmail&oauth_error=unknown"
    }

    conditional {
      if (($input.error|strlen) > 0) {
        var $google_detail {
          value = ($input.error ~ " " ~ $input.error_description)|url_encode_rfc3986
        }

        var.update $redirect_url {
          value = $base ~ "?oauth_provider=gmail&oauth_error=" ~ ($input.error|url_encode_rfc3986) ~ "&oauth_detail=" ~ $google_detail
        }
      }

      elseif (($input.code|strlen) == 0) {
        var.update $redirect_url {
          value = $base ~ "?oauth_provider=gmail&oauth_error=missing_code"
        }
      }

      elseif (($input.state|strlen) == 0) {
        var.update $redirect_url {
          value = $base ~ "?oauth_provider=gmail&oauth_error=missing_state"
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
              value = $base ~ "?oauth_provider=gmail&oauth_error=invalid_state"
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
              value = $base ~ "?oauth_provider=gmail&oauth_error=unknown"
            }

            conditional {
              if ($st.expires_at < now) {
                db.del email_outlook_oauth_state {
                  field_name = "id"
                  field_value = $st.id
                }

                var.update $redirect_url {
                  value = $base ~ "?oauth_provider=gmail&oauth_error=expired_state"
                }
              }

              else {
                db.del email_outlook_oauth_state {
                  field_name = "id"
                  field_value = $st.id
                }

                api.request {
                  url = "https://oauth2.googleapis.com/token"
                  method = "POST"
                  params = {}
                    |set:"client_id":($env.GOOGLE_CLIENT_ID|to_text)
                    |set:"client_secret":($env.GOOGLE_CLIENT_SECRET|to_text)
                    |set:"grant_type":"authorization_code"
                    |set:"code":($input.code|to_text)
                    |set:"redirect_uri":($env.GOOGLE_REDIRECT_URI|to_text)
                  headers = []
                    |push:"Content-Type: application/x-www-form-urlencoded"
                  timeout = 60
                } as $tok_res

                var $tr {
                  value = $tok_res.response
                }

                var $g_err {
                  value = ""
                }

                conditional {
                  if ($tr != null) {
                    var.update $g_err {
                      value = $tr|get:"error":""
                    }
                  }
                }

                var $g_desc {
                  value = ""
                }

                conditional {
                  if ($tr != null) {
                    var.update $g_desc {
                      value = $tr|get:"error_description":""
                    }
                  }
                }

                conditional {
                  if ($tr == null) {
                    var.update $redirect_url {
                      value = $base ~ "?oauth_provider=gmail&oauth_error=token_exchange"
                    }
                  }

                  elseif (($g_err|strlen) > 0) {
                    var $g_detail {
                      value = ($g_err ~ " " ~ $g_desc)|trim|url_encode_rfc3986
                    }

                    var.update $redirect_url {
                      value = $base ~ "?oauth_provider=gmail&oauth_error=google_oauth_token&oauth_detail=" ~ $g_detail
                    }
                  }

                  else {
                    var $at0 {
                      value = $tr|get:"access_token":""
                    }

                    conditional {
                      if (($at0|strlen) == 0) {
                        var.update $redirect_url {
                          value = $base ~ "?oauth_provider=gmail&oauth_error=token_exchange"
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
                              value = $base ~ "?oauth_provider=gmail&oauth_error=no_refresh_token&oauth_detail=" ~ $nr_detail
                            }
                          }

                          else {
                            api.request {
                              url = "https://www.googleapis.com/oauth2/v3/userinfo"
                              method = "GET"
                              headers = []
                                |push:"Authorization: Bearer " ~ $at0
                              timeout = 30
                            } as $me_res

                            var $profile {
                              value = $me_res.response
                            }

                            var $google_id {
                              value = $profile|get:"sub":""
                            }

                            var $mail {
                              value = $profile|get:"email":""
                            }

                            var $dname {
                              value = $profile|get:"name":""
                            }

                            conditional {
                              if ($profile == null) {
                                var.update $redirect_url {
                                  value = $base ~ "?oauth_provider=gmail&oauth_error=google_profile"
                                }
                              }

                              elseif (($google_id|strlen) == 0) {
                                var.update $redirect_url {
                                  value = $base ~ "?oauth_provider=gmail&oauth_error=no_google_id"
                                }
                              }

                              elseif (($mail|strlen) == 0) {
                                var.update $redirect_url {
                                  value = $base ~ "?oauth_provider=gmail&oauth_error=no_mailbox_email"
                                }
                              }

                              else {
                                var $exp_in {
                                  value = $tr|get:"expires_in":3600
                                }

                                var $access_exp {
                                  value = now|add_secs_to_timestamp:($exp_in|to_int)
                                }

                                var $scp {
                                  value = $tr|get:"scope":""
                                }

                                db.query email_oauth_connection {
                                  where = $db.email_oauth_connection.organisation_id == $st.organisation_id && $db.email_oauth_connection.provider == "gmail" && $db.email_oauth_connection.ms_user_id == $google_id
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
                                        provider          : "gmail"
                                      }
                                    } as $saved
                                  }

                                  else {
                                    db.add email_oauth_connection {
                                      data = {
                                        organisation_id   : $st.organisation_id
                                        created_by_user_id: $st.user_id
                                        provider          : "gmail"
                                        ms_tenant_id      : ""
                                        ms_user_id        : $google_id
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
                                  value = $base ~ "?oauth_provider=gmail&oauth_status=connected"
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