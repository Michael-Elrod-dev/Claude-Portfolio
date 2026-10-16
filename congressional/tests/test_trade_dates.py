"""Validation that rejects impossible transaction dates at ingest."""

from datetime import date

from congressional.models import plausible_transaction_date, sanitize_trade_dates

TODAY = date(2026, 6, 21)


def test_plausible_transaction_date():
    # In range (floor for a 2026 filing is 2024-01-01).
    assert plausible_transaction_date(date(2026, 3, 1), 2026, TODAY) == date(2026, 3, 1)
    assert plausible_transaction_date(date(2024, 1, 1), 2026, TODAY) == date(2024, 1, 1)

    # Future dates can't be disclosed yet.
    assert plausible_transaction_date(date(2027, 8, 12), 2026, TODAY) is None
    assert plausible_transaction_date(date(2026, 12, 31), 2026, TODAY) is None  # after today

    # Ancient sentinel / before the floor.
    assert plausible_transaction_date(date(1900, 1, 1), 2026, TODAY) is None
    assert plausible_transaction_date(date(2023, 12, 31), 2026, TODAY) is None

    assert plausible_transaction_date(None, 2026, TODAY) is None


def test_sanitize_trade_dates_nulls_in_place_and_counts():
    dicts = [
        {"transaction_date": date(2026, 3, 1)},  # ok
        {"transaction_date": date(2027, 8, 12)},  # future
        {"transaction_date": date(1900, 1, 1)},  # sentinel
        {"transaction_date": None},  # already null — not counted
    ]
    dropped = sanitize_trade_dates(dicts, 2026, TODAY)
    assert dropped == 2
    assert dicts[0]["transaction_date"] == date(2026, 3, 1)
    assert dicts[1]["transaction_date"] is None
    assert dicts[2]["transaction_date"] is None
    assert dicts[3]["transaction_date"] is None
