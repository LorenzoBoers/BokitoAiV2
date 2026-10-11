import inspect

from app.services import signal_threads as st

src = inspect.getsource(st.nav_badge_counts)
print("has_open_status:", "open_status" in src)
for i, line in enumerate(src.splitlines()):
    if any(k in line for k in ("unassigned", "open_status", "all_unread", "for_you_unread")):
        print(f"{i}: {line}")
