from datetime import date

import pytest

from brain.nutrition_tools import build_nutrition_tools
from nutrition import NutritionEngine, NutritionStore
from scheduler import Canvas, SchedulingEngine


@pytest.fixture
def setup(tmp_path):
    db_path = str(tmp_path / "canvas.db")
    canvas = Canvas(db_path)
    scheduling_engine = SchedulingEngine(canvas)
    store = NutritionStore(db_path)
    nutrition_engine = NutritionEngine(store, scheduling_engine)
    tools = {t.name: t for t in build_nutrition_tools(nutrition_engine)}
    yield tools
    store.close()
    canvas.close()


def test_log_meal_and_get_nutrition_status_round_trip(setup):
    tools = setup
    tools["set_nutrition_targets"].handler(
        calories=2200, protein_g=160, carbs_g=220, fat_g=70, water_ml=2500, effective_date="2026-08-05"
    )

    logged = tools["log_meal"].handler(
        foods=[{"name": "Chicken salad", "calories": 450, "protein_g": 40, "carbs_g": 20, "fat_g": 18}],
        eaten_at="2026-08-05T12:30:00",
    )
    assert logged["totals"]["protein_g"] == pytest.approx(40)
    assert logged["canvas_item_id"]

    status = tools["get_nutrition_status"].handler(date="2026-08-05")
    assert status["targets_default"] is False
    assert status["consumed"]["protein_g"] == pytest.approx(40)
    assert status["remaining"]["protein_g"] == pytest.approx(120)


def test_get_nutrition_status_defaults_to_today(setup):
    tools = setup
    result = tools["get_nutrition_status"].handler()
    assert result["date"] == date.today().isoformat()


def test_suggest_meal_slot_tool(setup):
    tools = setup
    tools["set_nutrition_targets"].handler(calories=2200, protein_g=160, carbs_g=220, fat_g=70, water_ml=2500)

    result = tools["suggest_meal_slot"].handler(date=date.today().isoformat(), duration_minutes=45)
    assert "urgency" in result
    assert "slot" in result
    assert "reason" in result


def test_supplement_lifecycle_via_tools(setup):
    tools = setup
    added = tools["add_supplement"].handler(name="Vitamin D", dosage="2000 IU", times=["08:00", "20:00"])
    assert added["name"] == "Vitamin D"

    pending = tools["get_pending_supplements"].handler(date="2026-08-05")
    assert len(pending["pending"]) + len(pending["missed"]) == 2

    taken = tools["log_supplement_taken"].handler(
        supplement_id=added["id"], scheduled_time="08:00", date="2026-08-05"
    )
    assert taken["time"] == "08:00"

    after = tools["get_pending_supplements"].handler(date="2026-08-05")
    assert any(t["time"] == "08:00" for t in after["taken"])
