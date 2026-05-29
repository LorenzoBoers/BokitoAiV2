// Create a new project with required autonomous_scope.
// Seeds a project_docs row + 8-page PRD scaffold (Overview, Vision and
// audience, Features and scope, Brand and voice, Tech stack, Marketing,
// Operations, Roadmap) so users start with structure, not a blank canvas.
// Each page gets a heading_1, callout, and paragraph block as a starting
// point. None are locked by default; users (and agents) can rename,
// delete, or add freely.
query projects verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    text name filters=trim|min:1
    text slug filters=trim|min:1
    text autonomous_scope filters=trim|min:30
    text description?
    bool autonomous_mode?
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

    var $auto_mode {
      value = $input.autonomous_mode != null ? $input.autonomous_mode : true
    }

    var $project_id {
      value = ""|uuid
    }

    db.add projects {
      data = {
        id              : $project_id
        tenant_id       : $me.organisation_id
        name            : $input.name
        slug            : $input.slug
        description     : $input.description
        autonomous_scope: $input.autonomous_scope
        autonomous_mode : $auto_mode
        active_domains  : []
      }
    } as $project

    var $doc_id {
      value = ""|uuid
    }

    db.add project_docs {
      data = {
        id        : $doc_id
        tenant_id : $me.organisation_id
        project_id: $project_id
        title     : $input.name
        created_at: now
        updated_at: now
      }
    } as $doc

    var $actor_label {
      value = (($me.first_name|to_string) ~ " " ~ ($me.last_name|to_string))|trim
    }

    conditional {
      if ($actor_label == "") {
        var.update $actor_label {
          value = $me.email|to_string
        }
      }
    }

    var $scaffold {
      value = [
        {
          slug : "overview"
          title: "Overview"
          kind : "overview"
          icon : "FileText"
          callout: "A one-paragraph snapshot of what this project is right now. Update this whenever the project's identity shifts."
          paragraph: $input.autonomous_scope
        }
        {
          slug : "vision-and-audience"
          title: "Vision and audience"
          kind : "vision"
          icon : "Telescope"
          callout: "Where this project is going and who it serves."
          paragraph: "Describe the long-term vision and the audience or customer this serves."
        }
        {
          slug : "features-and-scope"
          title: "Features and scope"
          kind : "features"
          icon : "Layers"
          callout: "Capabilities in scope, capabilities out of scope, and the why behind each choice."
          paragraph: "List the features this project offers today, and the ones explicitly out of scope."
        }
        {
          slug : "brand-and-voice"
          title: "Brand and voice"
          kind : "brand"
          icon : "Sparkles"
          callout: "Tone, naming, visual style, and writing rules. Agents read this before producing copy."
          paragraph: "Describe how this project sounds and looks. What words it uses, what it avoids."
        }
        {
          slug : "tech-stack"
          title: "Tech stack"
          kind : "tech"
          icon : "Code"
          callout: "Languages, frameworks, hosting, and integrations. Helps engineering agents pick the right tools."
          paragraph: "List the major technical building blocks, with the why for each choice."
        }
        {
          slug : "marketing"
          title: "Marketing"
          kind : "marketing"
          icon : "Megaphone"
          callout: "Channels, campaigns, and positioning."
          paragraph: "Describe how this project reaches its audience."
        }
        {
          slug : "operations"
          title: "Operations"
          kind : "operations"
          icon : "Settings"
          callout: "Day-to-day SOPs, support patterns, and incident response notes."
          paragraph: "Describe how the project is operated. SLAs, escalation paths, runbooks."
        }
        {
          slug : "roadmap"
          title: "Roadmap"
          kind : "roadmap"
          icon : "Map"
          callout: "What's next, in order. Agents pick up roadmap items as work."
          paragraph: "List the upcoming milestones and the order they should ship in."
        }
      ]
    }

    var $position {
      value = 0
    }

    foreach ($scaffold) {
      each as $page_def {
      var $page_id {
        value = ""|uuid
      }

      db.add doc_pages {
        data = {
          id            : $page_id
          tenant_id     : $me.organisation_id
          project_id    : $project_id
          doc_id        : $doc_id
          parent_page_id: null
          title         : $page_def.title
          slug          : $page_def.slug
          icon          : $page_def.icon
          kind          : $page_def.kind
          is_pinned     : false
          is_locked     : false
          position      : $position
          archived_at   : null
          created_at    : now
          updated_at    : now
        }
      } as $page

      var $heading_id {
        value = ""|uuid
      }

      db.add doc_blocks {
        data = {
          id                  : $heading_id
          tenant_id           : $me.organisation_id
          project_id          : $project_id
          page_id             : $page_id
          parent_block_id     : null
          type                : "heading_1"
          text                : [{text: $page_def.title}]
          props               : {}
          position            : 0
          created_by_type     : "user"
          created_by_id       : $me.id|to_string
          last_edited_by_type : "user"
          last_edited_by_id   : $me.id|to_string
          created_at          : now
          updated_at          : now
        }
      }

      var $callout_id {
        value = ""|uuid
      }

      db.add doc_blocks {
        data = {
          id                  : $callout_id
          tenant_id           : $me.organisation_id
          project_id          : $project_id
          page_id             : $page_id
          parent_block_id     : null
          type                : "callout"
          text                : [{text: $page_def.callout}]
          props               : {tone: "info", icon: "Info"}
          position            : 1
          created_by_type     : "user"
          created_by_id       : $me.id|to_string
          last_edited_by_type : "user"
          last_edited_by_id   : $me.id|to_string
          created_at          : now
          updated_at          : now
        }
      }

      var $paragraph_id {
        value = ""|uuid
      }

      db.add doc_blocks {
        data = {
          id                  : $paragraph_id
          tenant_id           : $me.organisation_id
          project_id          : $project_id
          page_id             : $page_id
          parent_block_id     : null
          type                : "paragraph"
          text                : [{text: $page_def.paragraph}]
          props               : {}
          position            : 2
          created_by_type     : "user"
          created_by_id       : $me.id|to_string
          last_edited_by_type : "user"
          last_edited_by_id   : $me.id|to_string
          created_at          : now
          updated_at          : now
        }
      }

      var.update $position {
        value = $position + 1
      }
      }
    }

    var $po_agent_id {
      value = ""|uuid
    }

    var $po_name {
      value = $input.name ~ " Orchestrator"
    }

    db.add agents {
      data = {
        id            : $po_agent_id
        tenant_id     : $me.organisation_id
        project_id    : $project_id
        name          : $po_name
        role          : "po"
        model         : "claude-sonnet-4"
        system_prompt : "You are the orchestrator for this project. North star: " ~ $input.autonomous_scope
        max_loops     : 25
        tools         : []
        is_active     : true
        updated_at    : now
      }
    } as $po_agent

    db.edit projects {
      field_name = "id"
      field_value = $project_id
      data = {po_agent_id: $po_agent_id, updated_at: now}
    } as $project
  }

  response = $project
}
