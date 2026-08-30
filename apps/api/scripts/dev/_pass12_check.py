"""Temporary Pass 12 inspection script. Safe to delete."""
import sqlite3

con = sqlite3.connect("dev.db")
print("--- recent notifications ---")
for r in con.execute(
    "select substr(id,1,8), kind, title, status, created_at from notifications "
    "order by created_at desc limit 8"
):
    print(r)
