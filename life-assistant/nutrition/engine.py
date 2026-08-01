from __future__ import annotations

from datetime import date as date_cls, datetime, time, timedelta
from typing import Any, Optional

from scheduler.engine import SchedulingEngine
from scheduler.models import ItemType, TimeSlot

from .models import FoodItem, MealLog, NutritionTargets, Supplement, SupplementLogEntry
from .storage import NutritionStore

DEFAULT_MEAL_DURATION = timedelta(minutes=30)

# Generic placeholders used only until the user sets their own targets via set_targets.
DEFAULT_TARGETS = {"calories": 2000.0, "protein_g": 150.0, "carbs_g": 200.0, "fat_g": 65.0, "water_ml": 2000.0}

# Waking-hours window used to gauge "how much of the day is gone" for meal urgency --
# matches the scheduling engine's own default day window.
DAY_START = time(7, 0)
DAY_END = time(22, 0)


class NutritionEngine:
    """Tracks food, targets, and supplements, and feeds the gap between what's been
    consumed and the day's targets into the scheduling engine as urgency -- e.g. a
    large protein deficit late in the day scores higher than the same gap at 8am.
    Nothing here does the engine's conflict/displacement math; it only calls into
    SchedulingEngine for that, exactly like the brain's tools do."""

    def __init__(self, store: NutritionStore, scheduling_engine: SchedulingEngine):
        self.store = store
        self.scheduling_engine = scheduling_engine

    # ---- targets ----

    def set_targets(
        self, effective_date: date_cls, calories: float, protein_g: float, carbs_g: float, fat_g: float, water_ml: float
    ) -> NutritionTargets:
        return self.store.set_targets(effective_date, calories, protein_g, carbs_g, fat_g, water_ml, is_default=False)

    def _get_or_seed_targets(self, day: date_cls) -> NutritionTargets:
        targets = self.store.get_active_targets(day)
        if targets is not None:
            return targets
        return self.store.set_targets(day, **DEFAULT_TARGETS, is_default=True)

    # ---- meals ----

    def log_meal(self, foods: list[dict[str, Any]], eaten_at: datetime, create_canvas_entry: bool = True) -> MealLog:
        """`foods` is a list of {"name", "calories", "protein_g", "carbs_g", "fat_g",
        "serving_size" (optional), "quantity" (optional, default 1.0)}. A food already
        in the catalog by name reuses its stored macros regardless of what's passed
        here -- the macro fields only matter the first time a food is logged."""
        resolved: list[tuple[FoodItem, float]] = []
        for food in foods:
            quantity = float(food.get("quantity", 1.0))
            item = self.store.upsert_food_item(
                name=food["name"],
                calories=float(food.get("calories", 0.0)),
                protein_g=float(food.get("protein_g", 0.0)),
                carbs_g=float(food.get("carbs_g", 0.0)),
                fat_g=float(food.get("fat_g", 0.0)),
                serving_size=food.get("serving_size", ""),
            )
            resolved.append((item, quantity))

        canvas_item_id = None
        if create_canvas_entry:
            end = eaten_at + DEFAULT_MEAL_DURATION
            # A meal being logged already happened -- don't negotiate or bump anything
            # for it. Only place it on the canvas if the slot is already free; otherwise
            # just skip the calendar link and keep the nutrition data.
            if not self.scheduling_engine.check_conflict(eaten_at, end):
                total_calories = sum(f.calories * q for f, q in resolved)
                proposal = self.scheduling_engine.add_task(
                    title="Meal: " + ", ".join(f.name for f, _ in resolved),
                    type=ItemType.MEAL,
                    start=eaten_at,
                    end=end,
                    urgency=2,
                    inertia=1,
                    type_data={"calories": total_calories},
                )
                canvas_item_id = proposal.requested.get("id")

        return self.store.insert_meal(eaten_at, resolved, canvas_item_id=canvas_item_id)

    def get_nutrition_status(self, day: date_cls) -> dict[str, Any]:
        targets = self._get_or_seed_targets(day)
        meals = self.store.list_meals_on(day)

        consumed = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
        for meal in meals:
            for key, value in meal.totals.items():
                consumed[key] += value

        remaining = {
            "calories": max(targets.calories - consumed["calories"], 0.0),
            "protein_g": max(targets.protein_g - consumed["protein_g"], 0.0),
            "carbs_g": max(targets.carbs_g - consumed["carbs_g"], 0.0),
            "fat_g": max(targets.fat_g - consumed["fat_g"], 0.0),
        }
        percent_of_target = {
            key: (consumed[key] / getattr(targets, key) * 100.0 if getattr(targets, key) else 100.0)
            for key in ("calories", "protein_g", "carbs_g", "fat_g")
        }

        return {
            "date": day.isoformat(),
            "targets_default": targets.is_default,
            "targets": {
                "calories": targets.calories,
                "protein_g": targets.protein_g,
                "carbs_g": targets.carbs_g,
                "fat_g": targets.fat_g,
                "water_ml": targets.water_ml,
            },
            "consumed": consumed,
            "remaining": remaining,
            "percent_of_target": percent_of_target,
            "meals_logged": len(meals),
        }

    # ---- nutrition-driven scheduling urgency ----

    def nutrition_gap_urgency(self, day: date_cls, at: Optional[datetime] = None) -> int:
        """1-5 urgency for scheduling a meal: a big remaining protein gap late in the
        day scores high; a small gap early in the day scores low."""
        at = at or datetime.now()
        status = self.get_nutrition_status(day)
        target_protein = status["targets"]["protein_g"]
        if target_protein <= 0:
            return 2

        gap_fraction = status["remaining"]["protein_g"] / target_protein
        day_start = datetime.combine(day, DAY_START)
        day_end = datetime.combine(day, DAY_END)
        elapsed_fraction = 0.0
        if at > day_start:
            elapsed_fraction = min((at - day_start) / (day_end - day_start), 1.0)

        score = gap_fraction * 0.6 + elapsed_fraction * 0.4
        if score >= 0.85:
            return 5
        if score >= 0.65:
            return 4
        if score >= 0.4:
            return 3
        if score >= 0.15:
            return 2
        return 1

    def suggest_meal_slot(
        self, day: date_cls, duration: timedelta = DEFAULT_MEAL_DURATION, at: Optional[datetime] = None
    ) -> dict[str, Any]:
        at = at or datetime.now()
        urgency = self.nutrition_gap_urgency(day, at)
        earliest = max(at, datetime.combine(day, time.min))
        slot: Optional[TimeSlot] = self.scheduling_engine.find_next_available(duration, urgency=urgency, earliest=earliest)
        status = self.get_nutrition_status(day)
        protein_remaining = status["remaining"]["protein_g"]

        if not status["targets_default"] and urgency >= 4:
            reason = f"Still {protein_remaining:.0f}g of protein short with much of the day gone -- worth fitting in soon."
        elif not status["targets_default"] and urgency == 3:
            reason = f"{protein_remaining:.0f}g of protein remaining today."
        elif status["targets_default"]:
            reason = "No personal targets set yet -- using generic defaults to estimate the gap."
        else:
            reason = "On track so far today."

        return {
            "urgency": urgency,
            "slot": {"start": slot.start.isoformat(), "end": slot.end.isoformat()} if slot else None,
            "protein_remaining_g": protein_remaining,
            "reason": reason,
        }

    # ---- supplements ----

    def add_supplement(self, name: str, dosage: str, times: list[str]) -> Supplement:
        return self.store.add_supplement(name, dosage, times)

    def log_supplement_taken(
        self, supplement_id: str, day: date_cls, scheduled_time: str, taken_at: Optional[datetime] = None
    ) -> SupplementLogEntry:
        return self.store.mark_supplement_taken(supplement_id, day, scheduled_time, taken_at or datetime.now())

    def get_pending_supplements(self, day: date_cls, at: Optional[datetime] = None) -> dict[str, Any]:
        at = at or datetime.now()
        is_today = day == at.date()
        is_future = day > at.date()

        pending: list[dict[str, Any]] = []
        taken: list[dict[str, Any]] = []
        missed: list[dict[str, Any]] = []

        for supplement in self.store.list_active_supplements():
            for scheduled_time in supplement.times:
                hour, minute = (int(part) for part in scheduled_time.split(":"))
                scheduled_dt = datetime.combine(day, time(hour, minute))
                entry = self.store.get_supplement_log_entry(supplement.id, day, scheduled_time)
                record = {
                    "supplement_id": supplement.id,
                    "name": supplement.name,
                    "dosage": supplement.dosage,
                    "time": scheduled_time,
                }
                if entry is not None:
                    taken.append({**record, "taken_at": entry.taken_at.isoformat()})
                elif is_future or (is_today and scheduled_dt > at):
                    pending.append(record)
                else:
                    missed.append(record)

        return {"date": day.isoformat(), "pending": pending, "taken": taken, "missed": missed}
