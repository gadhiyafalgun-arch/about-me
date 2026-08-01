from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date as date_cls, datetime
from typing import Optional

from .models import FoodItem, MealLog, MealLogItem, NutritionTargets, Supplement, SupplementLogEntry

SCHEMA = """
CREATE TABLE IF NOT EXISTS food_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL,
    carbs_g REAL NOT NULL,
    fat_g REAL NOT NULL,
    serving_size TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nutrition_targets (
    id TEXT PRIMARY KEY,
    effective_date TEXT NOT NULL,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL,
    carbs_g REAL NOT NULL,
    fat_g REAL NOT NULL,
    water_ml REAL NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_targets_effective_date ON nutrition_targets(effective_date);

CREATE TABLE IF NOT EXISTS meal_log (
    id TEXT PRIMARY KEY,
    eaten_at TEXT NOT NULL,
    canvas_item_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meal_log_eaten_at ON meal_log(eaten_at);

CREATE TABLE IF NOT EXISTS meal_log_items (
    id TEXT PRIMARY KEY,
    meal_log_id TEXT NOT NULL,
    food_item_id TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_meal_log_items_meal ON meal_log_items(meal_log_id);

CREATE TABLE IF NOT EXISTS supplements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    times TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplement_log (
    id TEXT PRIMARY KEY,
    supplement_id TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    UNIQUE(supplement_id, scheduled_date, scheduled_time)
);
CREATE INDEX IF NOT EXISTS idx_supplement_log_date ON supplement_log(scheduled_date);
"""


def new_id() -> str:
    return uuid.uuid4().hex


def _row_to_food_item(row: sqlite3.Row) -> FoodItem:
    return FoodItem(
        id=row["id"],
        name=row["name"],
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        serving_size=row["serving_size"],
        created_at=datetime.fromisoformat(row["created_at"]),
    )


def _row_to_targets(row: sqlite3.Row) -> NutritionTargets:
    return NutritionTargets(
        id=row["id"],
        effective_date=date_cls.fromisoformat(row["effective_date"]),
        calories=row["calories"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        water_ml=row["water_ml"],
        is_default=bool(row["is_default"]),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


def _row_to_supplement(row: sqlite3.Row) -> Supplement:
    return Supplement(
        id=row["id"],
        name=row["name"],
        dosage=row["dosage"],
        times=json.loads(row["times"]),
        active=bool(row["active"]),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


def _row_to_supplement_log(row: sqlite3.Row) -> SupplementLogEntry:
    return SupplementLogEntry(
        id=row["id"],
        supplement_id=row["supplement_id"],
        scheduled_date=date_cls.fromisoformat(row["scheduled_date"]),
        scheduled_time=row["scheduled_time"],
        taken_at=datetime.fromisoformat(row["taken_at"]),
    )


class NutritionStore:
    """SQLite-backed store for food/nutrition/supplement data. Extends the same
    database file the step-1 Canvas uses (same db_path) with its own tables,
    connected independently -- meal_log.canvas_item_id is a soft reference to a
    CanvasItem.id, the same style the Canvas store itself uses for its own rows."""

    def __init__(self, db_path: str = "canvas.db"):
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ---- food items ----

    def get_food_item_by_name(self, name: str) -> Optional[FoodItem]:
        row = self._conn.execute("SELECT * FROM food_items WHERE name = ?", (name,)).fetchone()
        return _row_to_food_item(row) if row else None

    def get_food_item(self, item_id: str) -> Optional[FoodItem]:
        row = self._conn.execute("SELECT * FROM food_items WHERE id = ?", (item_id,)).fetchone()
        return _row_to_food_item(row) if row else None

    def upsert_food_item(
        self, name: str, calories: float, protein_g: float, carbs_g: float, fat_g: float, serving_size: str = ""
    ) -> FoodItem:
        """Returns the existing catalog entry if `name` is already known -- new macros
        passed in are ignored in that case, since the catalog is authoritative once a
        food has been logged before."""
        existing = self.get_food_item_by_name(name)
        if existing:
            return existing
        item = FoodItem(
            id=new_id(),
            name=name,
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
            serving_size=serving_size,
            created_at=datetime.now(),
        )
        self._conn.execute(
            """INSERT INTO food_items (id, name, calories, protein_g, carbs_g, fat_g, serving_size, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                item.id,
                item.name,
                item.calories,
                item.protein_g,
                item.carbs_g,
                item.fat_g,
                item.serving_size,
                item.created_at.isoformat(),
            ),
        )
        self._conn.commit()
        return item

    # ---- nutrition targets ----

    def set_targets(
        self,
        effective_date: date_cls,
        calories: float,
        protein_g: float,
        carbs_g: float,
        fat_g: float,
        water_ml: float,
        is_default: bool = False,
    ) -> NutritionTargets:
        target = NutritionTargets(
            id=new_id(),
            effective_date=effective_date,
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
            water_ml=water_ml,
            is_default=is_default,
            created_at=datetime.now(),
        )
        self._conn.execute(
            """INSERT INTO nutrition_targets
               (id, effective_date, calories, protein_g, carbs_g, fat_g, water_ml, is_default, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                target.id,
                target.effective_date.isoformat(),
                target.calories,
                target.protein_g,
                target.carbs_g,
                target.fat_g,
                target.water_ml,
                int(target.is_default),
                target.created_at.isoformat(),
            ),
        )
        self._conn.commit()
        return target

    def get_active_targets(self, as_of: date_cls) -> Optional[NutritionTargets]:
        row = self._conn.execute(
            "SELECT * FROM nutrition_targets WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1",
            (as_of.isoformat(),),
        ).fetchone()
        if row is None:
            # Fall back to the earliest-known target if the user never set one before `as_of`.
            row = self._conn.execute("SELECT * FROM nutrition_targets ORDER BY effective_date ASC LIMIT 1").fetchone()
        return _row_to_targets(row) if row else None

    # ---- meal log ----

    def insert_meal(
        self, eaten_at: datetime, items: list[tuple[FoodItem, float]], canvas_item_id: Optional[str] = None
    ) -> MealLog:
        meal_id = new_id()
        created_at = datetime.now()
        self._conn.execute(
            "INSERT INTO meal_log (id, eaten_at, canvas_item_id, created_at) VALUES (?, ?, ?, ?)",
            (meal_id, eaten_at.isoformat(), canvas_item_id, created_at.isoformat()),
        )
        for food_item, quantity in items:
            self._conn.execute(
                "INSERT INTO meal_log_items (id, meal_log_id, food_item_id, quantity) VALUES (?, ?, ?, ?)",
                (new_id(), meal_id, food_item.id, quantity),
            )
        self._conn.commit()
        return MealLog(
            id=meal_id,
            eaten_at=eaten_at,
            items=[MealLogItem(food_item=f, quantity=q) for f, q in items],
            canvas_item_id=canvas_item_id,
            created_at=created_at,
        )

    def list_meals_on(self, day: date_cls) -> list[MealLog]:
        start = datetime.combine(day, datetime.min.time())
        end = datetime.combine(day, datetime.max.time())
        rows = self._conn.execute(
            "SELECT * FROM meal_log WHERE eaten_at BETWEEN ? AND ? ORDER BY eaten_at",
            (start.isoformat(), end.isoformat()),
        ).fetchall()

        meals = []
        for row in rows:
            item_rows = self._conn.execute(
                "SELECT * FROM meal_log_items WHERE meal_log_id = ?", (row["id"],)
            ).fetchall()
            items = []
            for item_row in item_rows:
                food = self.get_food_item(item_row["food_item_id"])
                if food:
                    items.append(MealLogItem(food_item=food, quantity=item_row["quantity"]))
            meals.append(
                MealLog(
                    id=row["id"],
                    eaten_at=datetime.fromisoformat(row["eaten_at"]),
                    items=items,
                    canvas_item_id=row["canvas_item_id"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                )
            )
        return meals

    # ---- supplements ----

    def add_supplement(self, name: str, dosage: str, times: list[str]) -> Supplement:
        supplement = Supplement(id=new_id(), name=name, dosage=dosage, times=times, active=True, created_at=datetime.now())
        self._conn.execute(
            "INSERT INTO supplements (id, name, dosage, times, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (supplement.id, supplement.name, supplement.dosage, json.dumps(times), 1, supplement.created_at.isoformat()),
        )
        self._conn.commit()
        return supplement

    def list_active_supplements(self) -> list[Supplement]:
        rows = self._conn.execute("SELECT * FROM supplements WHERE active = 1").fetchall()
        return [_row_to_supplement(r) for r in rows]

    def get_supplement_log_entry(
        self, supplement_id: str, scheduled_date: date_cls, scheduled_time: str
    ) -> Optional[SupplementLogEntry]:
        row = self._conn.execute(
            "SELECT * FROM supplement_log WHERE supplement_id=? AND scheduled_date=? AND scheduled_time=?",
            (supplement_id, scheduled_date.isoformat(), scheduled_time),
        ).fetchone()
        return _row_to_supplement_log(row) if row else None

    def mark_supplement_taken(
        self, supplement_id: str, scheduled_date: date_cls, scheduled_time: str, taken_at: datetime
    ) -> SupplementLogEntry:
        existing = self.get_supplement_log_entry(supplement_id, scheduled_date, scheduled_time)
        if existing:
            self._conn.execute("UPDATE supplement_log SET taken_at = ? WHERE id = ?", (taken_at.isoformat(), existing.id))
            self._conn.commit()
            existing.taken_at = taken_at
            return existing
        entry = SupplementLogEntry(
            id=new_id(), supplement_id=supplement_id, scheduled_date=scheduled_date, scheduled_time=scheduled_time,
            taken_at=taken_at,
        )
        self._conn.execute(
            """INSERT INTO supplement_log (id, supplement_id, scheduled_date, scheduled_time, taken_at)
               VALUES (?, ?, ?, ?, ?)""",
            (entry.id, supplement_id, scheduled_date.isoformat(), scheduled_time, taken_at.isoformat()),
        )
        self._conn.commit()
        return entry
