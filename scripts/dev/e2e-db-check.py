import sqlite3

c = sqlite3.connect("apps/api/dev.db")
rows = c.execute(
    "select substr(id,1,8), channel, contact_email, contact_name, subject "
    "from signals where contact_email like 'klant%' or channel='widget' "
    "order by created_at desc limit 6"
).fetchall()
for r in rows:
    print(r)
