import sqlite3

c = sqlite3.connect("apps/api/dev.db")
cur = c.cursor()

email_id = "7f129131ebf44beeb2349c20eb3e6392"
widget_id = "e29f476b3bbd4144991403a1ac9742f4"

row = cur.execute("select id, contact_name from signals where id = ?", (email_id,)).fetchone()
print("email signal row:", row)

cur.execute("update signals set contact_name = '' where id = ?", (email_id,))
print("contact_name reset:", cur.rowcount)

cur.execute(
    "delete from signal_messages where signal_id = ? and kind = 'decision_request'",
    (widget_id,),
)
print("widget decision messages removed:", cur.rowcount)
cur.execute(
    "delete from decision_requests where signal_id = ? and title = 'Reply to customer message'",
    (widget_id,),
)
print("widget decisions removed:", cur.rowcount)

c.commit()
