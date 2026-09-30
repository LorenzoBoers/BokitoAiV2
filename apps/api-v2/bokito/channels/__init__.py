"""Channel adapters. Importing the package registers every deliverer."""

from bokito.channels import email, phone, whatsapp, widget  # noqa: F401
from bokito.channels.base import deliver

__all__ = ["deliver"]
