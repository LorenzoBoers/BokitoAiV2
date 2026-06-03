import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel


class StaffAccessLog(SQLModel, table=True):
    __tablename__ = "staff_access_logs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    staff_user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    action: str = Field(default="enter")  # enter | leave
    created_at: datetime = Field(default_factory=datetime.utcnow)
