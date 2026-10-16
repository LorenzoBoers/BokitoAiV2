from app.services import workstreams as w

assert not hasattr(w, "_complete_run")
assert not hasattr(w, "_execute_agent_step")
print("purged_ok", w.start_run.__name__)
