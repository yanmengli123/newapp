"""Deprecated backend entrypoint.

Use:
    D:/soft/python310/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations


def main() -> None:
    raise SystemExit(
        "grcg6a_fastapi_backend.py is deprecated. Start the backend with: "
        "D:/soft/python310/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8001"
    )


if __name__ == "__main__":
    main()
