// Reaper: every 5 minutes flag any work_log still 'running' for > 10 minutes
// as 'failed' and append a reaped_by_timeout error event so the run list stops
// showing zombie rows. Runners should normally call /runs/complete; this is
// the safety net for crashed runners.
task run_reaper {
  description = "Mark zombie work_logs (running > 10 min) as failed every 5 minutes"

  stack {
    var $stale_threshold {
      value = (now|to_int) - 600000
    }

    db.query work_logs {
      where = $db.work_logs.status == "running" && $db.work_logs.started_at < $stale_threshold
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $stale

    foreach ($stale.items) {
      each as $log {
        var $existing_events {
          value = $log.events != null ? $log.events : []
        }

        var $reap_event {
          value = {
            type : "error"
            title: "reaped_by_timeout"
            body : "Run was still running after 10 minutes. The runner did not call /runs/complete; the reaper closed it as failed."
          }
        }

        var $next_events {
          value = $existing_events|merge:[$reap_event]
        }

        db.edit work_logs {
          field_name = "id"
          field_value = $log.id
          data = {
            status     : "failed"
            finished_at: now
            events     : $next_events
            updated_at : now
          }
        } as $updated
      }
    }
  }

  schedule = [{starts_on: 2026-05-23 12:30:00+0000, freq: 300}]

  history = "inherit"
}
