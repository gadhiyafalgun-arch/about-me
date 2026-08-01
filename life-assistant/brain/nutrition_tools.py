from __future__ import annotations

from datetime import date as date_cls, datetime, timedelta
from typing import Any, Optional

from nutrition import MealLog, NutritionEngine

from .types import Tool


def _serialize_meal(meal: MealLog) -> dict[str, Any]:
    return {
        "id": meal.id,
        "eaten_at": meal.eaten_at.isoformat(),
        "canvas_item_id": meal.canvas_item_id,
        "items": [
            {
                "name": entry.food_item.name,
                "quantity": entry.quantity,
                "calories": entry.food_item.calories * entry.quantity,
                "protein_g": entry.food_item.protein_g * entry.quantity,
                "carbs_g": entry.food_item.carbs_g * entry.quantity,
                "fat_g": entry.food_item.fat_g * entry.quantity,
            }
            for entry in meal.items
        ],
        "totals": meal.totals,
    }


def build_nutrition_tools(engine: NutritionEngine) -> list[Tool]:
    """Expose the NutritionEngine as tools the brain can call. Handlers only parse
    input and serialize output; every gap/urgency computation stays in the engine."""

    def log_meal(foods: list[dict[str, Any]], eaten_at: Optional[str] = None) -> dict[str, Any]:
        when = datetime.fromisoformat(eaten_at) if eaten_at else datetime.now()
        meal = engine.log_meal(foods, when)
        return _serialize_meal(meal)

    def get_nutrition_status(date: Optional[str] = None) -> dict[str, Any]:
        day = date_cls.fromisoformat(date) if date else date_cls.today()
        return engine.get_nutrition_status(day)

    def set_nutrition_targets(
        calories: float,
        protein_g: float,
        carbs_g: float,
        fat_g: float,
        water_ml: float,
        effective_date: Optional[str] = None,
    ) -> dict[str, Any]:
        day = date_cls.fromisoformat(effective_date) if effective_date else date_cls.today()
        targets = engine.set_targets(day, calories, protein_g, carbs_g, fat_g, water_ml)
        return {
            "effective_date": targets.effective_date.isoformat(),
            "calories": targets.calories,
            "protein_g": targets.protein_g,
            "carbs_g": targets.carbs_g,
            "fat_g": targets.fat_g,
            "water_ml": targets.water_ml,
        }

    def suggest_meal_slot(date: Optional[str] = None, duration_minutes: int = 30) -> dict[str, Any]:
        day = date_cls.fromisoformat(date) if date else date_cls.today()
        return engine.suggest_meal_slot(day, duration=timedelta(minutes=duration_minutes))

    def add_supplement(name: str, dosage: str, times: list[str]) -> dict[str, Any]:
        supplement = engine.add_supplement(name, dosage, times)
        return {"id": supplement.id, "name": supplement.name, "dosage": supplement.dosage, "times": supplement.times}

    def get_pending_supplements(date: Optional[str] = None) -> dict[str, Any]:
        day = date_cls.fromisoformat(date) if date else date_cls.today()
        return engine.get_pending_supplements(day)

    def log_supplement_taken(supplement_id: str, scheduled_time: str, date: Optional[str] = None) -> dict[str, Any]:
        day = date_cls.fromisoformat(date) if date else date_cls.today()
        entry = engine.log_supplement_taken(supplement_id, day, scheduled_time)
        return {
            "supplement_id": entry.supplement_id,
            "date": entry.scheduled_date.isoformat(),
            "time": entry.scheduled_time,
            "taken_at": entry.taken_at.isoformat(),
        }

    return [
        Tool(
            name="log_meal",
            description=(
                "Log a meal the user actually ate. For each food, give your best estimate of "
                "calories/protein_g/carbs_g/fat_g for the given quantity -- if the food has been "
                "logged before, the stored catalog values are reused automatically and your "
                "estimate is ignored, so it only matters the first time. This records nutrition "
                "data and, if the time slot is free, adds a matching entry to the calendar; it "
                "never bumps anything else to make room, since the meal already happened."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "foods": {
                        "type": "array",
                        "description": "The foods that made up this meal.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "calories": {"type": "number", "description": "For the given quantity."},
                                "protein_g": {"type": "number"},
                                "carbs_g": {"type": "number"},
                                "fat_g": {"type": "number"},
                                "serving_size": {"type": "string", "description": "e.g. '1 cup (150g)'."},
                                "quantity": {"type": "number", "description": "Multiplier on the serving. Defaults to 1."},
                            },
                            "required": ["name", "calories", "protein_g", "carbs_g", "fat_g"],
                        },
                    },
                    "eaten_at": {"type": "string", "description": "ISO 8601 datetime. Defaults to now."},
                },
                "required": ["foods"],
            },
            handler=log_meal,
        ),
        Tool(
            name="get_nutrition_status",
            description=(
                "Get how close the user is to their nutrition targets on a given date: consumed "
                "vs. remaining calories/protein/carbs/fat and how many meals were logged."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD. Defaults to today."},
                },
                "required": [],
            },
            handler=get_nutrition_status,
        ),
        Tool(
            name="set_nutrition_targets",
            description="Set (or update) the user's daily nutrition targets, effective from a given date forward.",
            parameters={
                "type": "object",
                "properties": {
                    "calories": {"type": "number"},
                    "protein_g": {"type": "number"},
                    "carbs_g": {"type": "number"},
                    "fat_g": {"type": "number"},
                    "water_ml": {"type": "number"},
                    "effective_date": {"type": "string", "description": "YYYY-MM-DD. Defaults to today."},
                },
                "required": ["calories", "protein_g", "carbs_g", "fat_g", "water_ml"],
            },
            handler=set_nutrition_targets,
        ),
        Tool(
            name="suggest_meal_slot",
            description=(
                "Find the next good time to fit in a meal, weighted by how urgent the remaining "
                "nutrition gap is (a big protein deficit late in the day scores more urgent than "
                "the same gap in the morning). Use this instead of find_next_available when the "
                "request is really about closing a nutrition gap, not an arbitrary task."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD. Defaults to today."},
                    "duration_minutes": {"type": "integer", "minimum": 1, "description": "Defaults to 30."},
                },
                "required": [],
            },
            handler=suggest_meal_slot,
        ),
        Tool(
            name="add_supplement",
            description="Register a new supplement on a recurring daily schedule.",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "dosage": {"type": "string", "description": "e.g. '500mg', '1 capsule'."},
                    "times": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Times of day in 24h HH:MM, e.g. ['08:00', '20:00'].",
                    },
                },
                "required": ["name", "dosage", "times"],
            },
            handler=add_supplement,
        ),
        Tool(
            name="get_pending_supplements",
            description="List which of the user's supplements are pending, taken, or missed on a given date.",
            parameters={
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD. Defaults to today."},
                },
                "required": [],
            },
            handler=get_pending_supplements,
        ),
        Tool(
            name="log_supplement_taken",
            description=(
                "Mark a specific scheduled supplement dose as taken. Use the supplement_id and "
                "time from a previous get_pending_supplements call."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "supplement_id": {"type": "string"},
                    "scheduled_time": {"type": "string", "description": "HH:MM matching one of the supplement's times."},
                    "date": {"type": "string", "description": "YYYY-MM-DD. Defaults to today."},
                },
                "required": ["supplement_id", "scheduled_time"],
            },
            handler=log_supplement_taken,
        ),
    ]
