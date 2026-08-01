from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator, Optional

from .models import CanvasItem, ItemStatus, ItemType

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    urgency INTEGER NOT NULL,
    inertia INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    type_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_start ON items(start);
CREATE INDEX IF NOT EXISTS idx_items_end ON items(end);
"""


def new_id() -> str:
    return uuid.uuid4().hex


def _row_to_item(row: sqlite3.Row) -> CanvasItem:
    return CanvasItem(
        id=row["id"],
        title=row["title"],
        type=ItemType(row["type"]),
        start=datetime.fromisoformat(row["start"]),
        end=datetime.fromisoformat(row["end"]),
        urgency=row["urgency"],
        inertia=row["inertia"],
        status=ItemStatus(row["status"]),
        type_data=json.loads(row["type_data"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )


class Canvas:
    """SQLite-backed store for the date-indexed schedule canvas."""

    def __init__(self, db_path: str = "canvas.db"):
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        self._in_transaction = False

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Group multiple insert/update/delete calls into one atomic commit.
        Callers doing a multi-step operation (e.g. displacing several items
        before writing the new one) opt in with `with canvas.transaction():`.
        On any exception, every change made inside the block is rolled back;
        calls outside a `transaction()` block keep committing immediately, as
        before."""
        if self._in_transaction:
            yield  # already inside an outer transaction -- let it own commit/rollback
            return
        self._in_transaction = True
        try:
            yield
        except BaseException:
            self._conn.rollback()
            raise
        else:
            self._conn.commit()
        finally:
            self._in_transaction = False

    def insert(self, item: CanvasItem) -> CanvasItem:
        now = datetime.now()
        item.created_at = item.created_at or now
        item.updated_at = now
        self._conn.execute(
            """INSERT INTO items
               (id, title, type, start, end, urgency, inertia, status, type_data, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                item.id,
                item.title,
                item.type.value,
                item.start.isoformat(),
                item.end.isoformat(),
                item.urgency,
                item.inertia,
                item.status.value,
                json.dumps(item.type_data),
                item.created_at.isoformat(),
                item.updated_at.isoformat(),
            ),
        )
        if not self._in_transaction:
            self._conn.commit()
        return item

    def get(self, item_id: str) -> Optional[CanvasItem]:
        row = self._conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return _row_to_item(row) if row else None

    def update(self, item: CanvasItem) -> CanvasItem:
        item.updated_at = datetime.now()
        self._conn.execute(
            """UPDATE items SET title=?, type=?, start=?, end=?, urgency=?, inertia=?,
               status=?, type_data=?, updated_at=? WHERE id=?""",
            (
                item.title,
                item.type.value,
                item.start.isoformat(),
                item.end.isoformat(),
                item.urgency,
                item.inertia,
                item.status.value,
                json.dumps(item.type_data),
                item.updated_at.isoformat(),
                item.id,
            ),
        )
        if not self._in_transaction:
            self._conn.commit()
        return item

    def delete(self, item_id: str) -> None:
        self._conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        if not self._in_transaction:
            self._conn.commit()

    def list_between(
        self,
        start: datetime,
        end: datetime,
        exclude_id: Optional[str] = None,
        active_only: bool = True,
    ) -> list[CanvasItem]:
        """Items whose [start, end) overlaps the given window, earliest first."""
        query = "SELECT * FROM items WHERE start < ? AND end > ?"
        params: list = [end.isoformat(), start.isoformat()]
        if active_only:
            query += " AND status = ?"
            params.append(ItemStatus.SCHEDULED.value)
        if exclude_id:
            query += " AND id != ?"
            params.append(exclude_id)
        query += " ORDER BY start"
        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_item(r) for r in rows]
