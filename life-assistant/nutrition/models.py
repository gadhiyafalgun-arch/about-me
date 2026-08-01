from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_cls, datetime
from typing import Optional


@dataclass
class FoodItem:
    """A reusable catalog entry: macros/calories per one serving of a named food."""

    id: str
    name: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_size: str = ""
    created_at: Optional[datetime] = None


@dataclass
class NutritionTargets:
    """Daily targets, effective from `effective_date` forward until superseded by a
    later target row. `is_default` marks a target the engine auto-seeded because none
    had been set yet -- not one the user actually chose."""

    id: str
    effective_date: date_cls
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    water_ml: float
    is_default: bool = False
    created_at: Optional[datetime] = None


@dataclass
class MealLogItem:
    food_item: FoodItem
    quantity: float = 1.0


@dataclass
class MealLog:
    id: str
    eaten_at: datetime
    items: list[MealLogItem] = field(default_factory=list)
    canvas_item_id: Optional[str] = None
    created_at: Optional[datetime] = None

    @property
    def totals(self) -> dict[str, float]:
        totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
        for entry in self.items:
            f = entry.food_item
            totals["calories"] += f.calories * entry.quantity
            totals["protein_g"] += f.protein_g * entry.quantity
            totals["carbs_g"] += f.carbs_g * entry.quantity
            totals["fat_g"] += f.fat_g * entry.quantity
        return totals


@dataclass
class Supplement:
    id: str
    name: str
    dosage: str
    times: list[str]  # daily times of day as "HH:MM" strings
    active: bool = True
    created_at: Optional[datetime] = None


@dataclass
class SupplementLogEntry:
    """A supplement dose that was actually taken. There is no row for a pending or
    missed dose -- those are computed on the fly from the absence of a matching entry
    plus the current time, not stored as a status."""

    id: str
    supplement_id: str
    scheduled_date: date_cls
    scheduled_time: str
    taken_at: datetime
