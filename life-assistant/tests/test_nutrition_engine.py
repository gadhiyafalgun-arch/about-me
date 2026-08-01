from datetime import date, datetime

import pytest

from nutrition import NutritionEngine, NutritionStore
from scheduler import Canvas, ItemType, SchedulingEngine


@pytest.fixture
def setup(tmp_path):
    # NutritionStore and Canvas open independent connections to the *same* file so
    # meal_log.canvas_item_id can reference real canvas items -- unlike ":memory:",
    # which is private per connection and wouldn't be shared between them.
    db_path = str(tmp_path / "canvas.db")
    canvas = Canvas(db_path)
    scheduling_engine = SchedulingEngine(canvas)
    store = NutritionStore(db_path)
    nutrition_engine = NutritionEngine(store, scheduling_engine)
    yield nutrition_engine, scheduling_engine
    store.close()
    canvas.close()


def test_log_meal_creates_food_catalog_entries_and_canvas_link(setup):
    engine, scheduling_engine = setup
    eaten_at = datetime(2026, 8, 5, 12, 30)

    meal = engine.log_meal(
        [
            {"name": "Grilled chicken breast", "calories": 250, "protein_g": 40, "carbs_g": 0, "fat_g": 8},
            {"name": "Mixed greens", "calories": 30, "protein_g": 2, "carbs_g": 5, "fat_g": 0},
        ],
        eaten_at,
    )

    assert len(meal.items) == 2
    assert meal.totals["calories"] == pytest.approx(280)
    assert meal.totals["protein_g"] == pytest.approx(42)
    assert meal.canvas_item_id is not None

    canvas_items = scheduling_engine.get_schedule(date(2026, 8, 5))
    assert len(canvas_items) == 1
    assert canvas_items[0].id == meal.canvas_item_id
    assert canvas_items[0].type == ItemType.MEAL


def test_log_meal_reuses_existing_food_item_macros(setup):
    engine, _ = setup
    engine.log_meal(
        [{"name": "Protein shake", "calories": 200, "protein_g": 30, "carbs_g": 10, "fat_g": 3}],
        datetime(2026, 8, 5, 8, 0),
    )

    # Second log passes different (wrong) macros -- the catalog entry should win.
    second = engine.log_meal(
        [{"name": "Protein shake", "calories": 999, "protein_g": 999, "carbs_g": 999, "fat_g": 999, "quantity": 2}],
        datetime(2026, 8, 5, 16, 0),
    )

    assert second.items[0].food_item.protein_g == 30
    assert second.totals["protein_g"] == pytest.approx(60)  # 30 * quantity 2


def test_log_meal_skips_canvas_link_on_conflict_but_still_logs_nutrition(setup):
    engine, scheduling_engine = setup
    scheduling_engine.add_task(
        "Important meeting", ItemType.MEETING, datetime(2026, 8, 5, 12, 0), datetime(2026, 8, 5, 13, 0),
        urgency=5, inertia=5,
    )

    meal = engine.log_meal(
        [{"name": "Sandwich", "calories": 400, "protein_g": 20, "carbs_g": 40, "fat_g": 15}],
        datetime(2026, 8, 5, 12, 15),
    )

    assert meal.canvas_item_id is None  # not linked -- would have collided with the meeting
    assert meal.totals["calories"] == pytest.approx(400)  # nutrition still recorded

    canvas_items = scheduling_engine.get_schedule(date(2026, 8, 5))
    assert len(canvas_items) == 1
    assert canvas_items[0].title == "Important meeting"  # untouched, not displaced


def test_get_nutrition_status_auto_seeds_default_targets(setup):
    engine, _ = setup
    status = engine.get_nutrition_status(date(2026, 8, 5))

    assert status["targets_default"] is True
    assert status["targets"]["calories"] == 2000
    assert status["meals_logged"] == 0
    assert status["remaining"]["protein_g"] == 150


def test_get_nutrition_status_reflects_targets_and_logged_meals(setup):
    engine, _ = setup
    engine.set_targets(date(2026, 8, 5), calories=2200, protein_g=160, carbs_g=220, fat_g=70, water_ml=2500)
    engine.log_meal(
        [{"name": "Chicken salad", "calories": 450, "protein_g": 40, "carbs_g": 20, "fat_g": 18}],
        datetime(2026, 8, 5, 12, 30),
    )

    status = engine.get_nutrition_status(date(2026, 8, 5))

    assert status["targets_default"] is False
    assert status["consumed"]["protein_g"] == pytest.approx(40)
    assert status["remaining"]["protein_g"] == pytest.approx(120)
    assert status["percent_of_target"]["protein_g"] == pytest.approx(25.0)


def test_nutrition_gap_urgency_rises_later_in_the_day_with_a_big_gap(setup):
    engine, _ = setup
    engine.set_targets(date(2026, 8, 5), calories=2200, protein_g=160, carbs_g=220, fat_g=70, water_ml=2500)
    # No meals logged -- full protein gap all day.

    morning_urgency = engine.nutrition_gap_urgency(date(2026, 8, 5), at=datetime(2026, 8, 5, 8, 0))
    evening_urgency = engine.nutrition_gap_urgency(date(2026, 8, 5), at=datetime(2026, 8, 5, 20, 0))

    assert evening_urgency > morning_urgency


def test_suggest_meal_slot_returns_free_slot_with_reason(setup):
    engine, scheduling_engine = setup
    scheduling_engine.add_task(
        "Deadline", ItemType.TASK, datetime(2026, 8, 5, 9, 0), datetime(2026, 8, 5, 12, 0), urgency=5, inertia=4
    )
    engine.set_targets(date(2026, 8, 5), calories=2200, protein_g=160, carbs_g=220, fat_g=70, water_ml=2500)

    suggestion = engine.suggest_meal_slot(date(2026, 8, 5), at=datetime(2026, 8, 5, 8, 0))

    assert suggestion["slot"] is not None
    assert suggestion["slot"]["start"] >= "2026-08-05T12:00:00" or suggestion["slot"]["start"] < "2026-08-05T09:00:00"
    assert isinstance(suggestion["urgency"], int)
    assert suggestion["reason"]


def test_add_supplement_and_pending_before_scheduled_time(setup):
    engine, _ = setup
    supplement = engine.add_supplement("Vitamin D", "2000 IU", ["08:00", "20:00"])

    result = engine.get_pending_supplements(date(2026, 8, 5), at=datetime(2026, 8, 5, 7, 0))

    assert len(result["pending"]) == 2
    assert result["taken"] == []
    assert result["missed"] == []
    assert result["pending"][0]["supplement_id"] == supplement.id


def test_supplement_becomes_missed_after_scheduled_time_passes_without_being_taken(setup):
    engine, _ = setup
    engine.add_supplement("Vitamin D", "2000 IU", ["08:00", "20:00"])

    result = engine.get_pending_supplements(date(2026, 8, 5), at=datetime(2026, 8, 5, 9, 0))

    assert len(result["missed"]) == 1
    assert result["missed"][0]["time"] == "08:00"
    assert len(result["pending"]) == 1
    assert result["pending"][0]["time"] == "20:00"


def test_log_supplement_taken_moves_it_out_of_missed(setup):
    engine, _ = setup
    supplement = engine.add_supplement("Vitamin D", "2000 IU", ["08:00"])

    engine.log_supplement_taken(supplement.id, date(2026, 8, 5), "08:00", taken_at=datetime(2026, 8, 5, 8, 5))
    result = engine.get_pending_supplements(date(2026, 8, 5), at=datetime(2026, 8, 5, 9, 0))

    assert result["missed"] == []
    assert len(result["taken"]) == 1
    assert result["taken"][0]["time"] == "08:00"


def test_future_date_supplements_are_pending_not_missed(setup):
    engine, _ = setup
    engine.add_supplement("Vitamin D", "2000 IU", ["08:00"])

    result = engine.get_pending_supplements(date(2026, 8, 6), at=datetime(2026, 8, 5, 9, 0))

    assert len(result["pending"]) == 1
    assert result["missed"] == []
