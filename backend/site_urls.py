"""One configured public origin for search metadata and notification links."""

import os
from urllib.parse import urlsplit

DEFAULT_PUBLIC_SITE_URL = "https://stock-insight-zws6.onrender.com"


def public_site_url() -> str:
    value = os.environ.get("PUBLIC_SITE_URL", "").strip() or DEFAULT_PUBLIC_SITE_URL
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in {"http", "https"}
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and parsed.path.strip("/") == ""
            and not parsed.query
            and not parsed.fragment
            and not any(char.isspace() or char in "<>\"'\\" for char in value)
        )
        parsed.port  # Reject invalid port numbers before serving public metadata.
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("PUBLIC_SITE_URL must be an HTTP(S) origin without a path or credentials")
    return value.rstrip("/")
