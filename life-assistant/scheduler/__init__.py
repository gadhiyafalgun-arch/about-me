from .engine import SchedulingEngine, is_displaceable
from .models import (
    CanvasItem,
    DisplacementPlan,
    ItemStatus,
    ItemType,
    SchedulingProposal,
    TimeSlot,
)
from .storage import Canvas

__all__ = [
    "SchedulingEngine",
    "is_displaceable",
    "Canvas",
    "CanvasItem",
    "DisplacementPlan",
    "ItemStatus",
    "ItemType",
    "SchedulingProposal",
    "TimeSlot",
]


def create_engine(db_path: str = "canvas.db") -> SchedulingEngine:
    return SchedulingEngine(Canvas(db_path))
