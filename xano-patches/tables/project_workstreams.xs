table "project_workstreams" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    uuid tenant_id {
      description = "Organisation (tenant)"
    }

    uuid project_id {
      table = "projects"
      description = "Parent project"
    }

    text name filters=trim {
      description = "Workstream display name"
    }

    text slug filters=trim {
      description = "URL-safe slug, unique per project"
    }

    enum status?=draft {
      values = ["active", "draft", "paused"]
      description = "Workstream lifecycle status"
    }

    text trigger_text? filters=trim {
      description = "Input trigger description"
    }

    text output_text? filters=trim {
      description = "Output description"
    }

    json steps?=[] {
      description = "Ordered step definitions for the wireframe editor"
    }

    int position?=0 {
      description = "Sidebar order"
    }

    timestamp last_active_at? {
      description = "Last execution or activity timestamp"
    }

    timestamp created_at?=now {
      description = "Created at"
    }

    timestamp updated_at?=now {
      description = "Updated at"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "project_id", op: "asc"}, {name: "position", op: "asc"}]
    }
    {
      type : "btree|unique"
      field: [{name: "project_id", op: "asc"}, {name: "slug", op: "asc"}]
    }
  ]
}
