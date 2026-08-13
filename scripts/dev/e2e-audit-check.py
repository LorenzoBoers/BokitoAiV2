import sqlite3

c = sqlite3.connect("apps/api/dev.db")
rows = c.execute(
    "select action, outcome, after_json from audit_events "
    "where action like '%send_reply%' order by created_at desc limit 3"
).fetchall()
for action, outcome, after in rows:
    print(action, "|", outcome)
    print((after or "")[:800])
    print("---")
