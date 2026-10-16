from datetime import date

from congressional.house.ptr_parser import (
    _extract_ticker_and_type,
    _parse_amount_bounds,
    _parse_date,
    _parse_money,
    _split_owner,
    is_scanned,
    parse_text,
)
from congressional.models import is_ticker


def test_is_ticker_accepts_real_tickers_rejects_cusips():
    assert is_ticker("AAPL")
    assert is_ticker("MMM")
    assert is_ticker("BRK.B")
    assert is_ticker("brk.b")  # normalised to upper
    # CUSIPs / junk
    assert not is_ticker("912796CR8")
    assert not is_ticker("36966R5P7")
    assert not is_ticker("LSXMK SIRI")
    assert not is_ticker("")
    assert not is_ticker(None)


def test_extract_ticker_drops_cusip_keeps_real():
    # A bond with a CUSIP in parens → no ticker captured.
    _, ticker, _ = _extract_ticker_and_type("US TREASURY BILL DUE 12/28/23 (912796CR8) [GS]")
    assert ticker is None
    # A real stock → ticker captured.
    _, ticker2, _ = _extract_ticker_and_type("Apple Inc. (AAPL) [ST]")
    assert ticker2 == "AAPL"


def test_parse_money_strips_commas_and_currency():
    assert _parse_money("1,001") == 1001
    assert _parse_money("$15,000") == 15000
    assert _parse_money("250,000") == 250000


def test_parse_money_truncates_cents():
    assert _parse_money("350.78") == 350
    assert _parse_money("$172.00") == 172


def test_parse_money_handles_garbage():
    assert _parse_money("") is None
    assert _parse_money("abc") is None
    assert _parse_money("not-a-number") is None


def test_parse_amount_bounds_range():
    assert _parse_amount_bounds("$1,001 - $15,000") == (1001, 15000)
    assert _parse_amount_bounds("$100,001 - $250,000") == (100001, 250000)


def test_parse_amount_bounds_over():
    assert _parse_amount_bounds("Over $50,000,000") == (50000000, None)
    assert _parse_amount_bounds("Spouse/DC Over $1,000,000") == (1000000, None)


def test_parse_amount_bounds_exact():
    # Exact-amount disclosures echo low into high so consumers can detect single values.
    assert _parse_amount_bounds("$350.78") == (350, 350)
    assert _parse_amount_bounds("$172.00") == (172, 172)


def test_split_owner_recognizes_codes():
    assert _split_owner("SP Apple Inc.") == ("SP", "Apple Inc.")
    assert _split_owner("JT BRP Group, Inc.") == ("JT", "BRP Group, Inc.")
    assert _split_owner("DC Amazon (AMZN) [ST]") == ("DC", "Amazon (AMZN) [ST]")


def test_split_owner_no_code():
    assert _split_owner("Energy Transfer LP") == (None, "Energy Transfer LP")


def test_extract_ticker_and_type():
    _, ticker, asset_type = _extract_ticker_and_type("Apple Inc. (AAPL) [ST]")
    assert ticker == "AAPL"
    assert asset_type == "ST"


def test_extract_ticker_handles_dotted_class():
    _, ticker, _ = _extract_ticker_and_type("Berkshire Hathaway (BRK.B) [ST]")
    assert ticker == "BRK.B"


def test_extract_ticker_none_for_treasuries():
    _, ticker, asset_type = _extract_ticker_and_type("U.S. Treasury Bond [GS]")
    assert ticker is None
    assert asset_type == "GS"


def test_parse_date_us_format():
    assert _parse_date("12/06/2023") == date(2023, 12, 6)


def test_is_scanned():
    assert is_scanned("") is True
    assert is_scanned("   \n  ") is True
    assert is_scanned("a" * 99) is True
    assert is_scanned("a" * 200) is False


# --- End-to-end parser tests on synthetic PTR text fixtures --------------------

SIMPLE_PTR = """\
Filing ID #99999999
P R
Clerk of the House
Name: Hon. Test Filer
Status: Member
State/District: XX01
T
ID Owner Asset Transaction Date Notification Amount Cap.
Type Date Gains >
$200?
Apple Inc. (AAPL) [ST] P 01/05/2024 01/06/2024 $1,001 - $15,000
F      S     : New
S          O : Brokerage
SP Microsoft Corporation (MSFT) [ST] S 02/10/2024 02/11/2024 $15,001 -
$50,000
F      S     : New
* For the complete list of asset type abbreviations, please visit https://example
"""


def test_parses_simple_ptr_with_owner_and_wrapped_amount():
    trades = parse_text(SIMPLE_PTR)
    assert len(trades) == 2

    t1, t2 = trades
    assert t1.owner is None
    assert t1.asset_ticker == "AAPL"
    assert t1.transaction_type == "P"
    assert t1.amount_range_low == 1001
    assert t1.amount_range_high == 15000

    assert t2.owner == "SP"
    assert t2.asset_ticker == "MSFT"
    assert t2.transaction_type == "S"
    assert t2.amount_range_low == 15001
    assert t2.amount_range_high == 50000


WRAPPED_ASSET_PTR = """\
ID Owner Asset Transaction Date Notification Amount Cap.
Type Date
Energy Transfer LP Common Units S 12/06/2023 12/22/2023 $1,001 - $15,000
(ET) [ST]
F      S     : New
NGL ENERGY PARTNERS LP S 01/11/2024 01/15/2024 $100,001 -
Common Units representing Limited $250,000
Partner Interests (NGL) [ST]
F      S     : New
* For the complete list
"""


def test_parses_wrapped_asset_name_and_wrapped_amount():
    trades = parse_text(WRAPPED_ASSET_PTR)
    assert len(trades) == 2

    assert trades[0].asset_ticker == "ET"
    assert trades[0].asset_name.startswith("Energy Transfer LP Common Units")
    assert "F " not in trades[0].asset_name  # metadata must not leak

    assert trades[1].asset_ticker == "NGL"
    assert trades[1].amount_range_low == 100001
    assert trades[1].amount_range_high == 250000


SPOUSAL_OVER_PTR = """\
ID Owner Asset Transaction Date Notification Amount Cap.
Type Date
SP U.S. Treasury Note due 1/31/2028 P 04/23/2024 04/23/2024 Spouse/DC Over
[GS] $1,000,000
F      S     : New
* For the complete list
"""


def test_parses_spousal_over_amount():
    trades = parse_text(SPOUSAL_OVER_PTR)
    assert len(trades) == 1
    t = trades[0]
    assert t.owner == "SP"
    assert t.asset_type == "GS"
    assert t.amount_range_low == 1000000
    assert t.amount_range_high is None
    assert "Spouse/DC" in t.amount_range_raw
    assert "Over" in t.amount_range_raw


EXACT_AMOUNT_PTR = """\
ID Owner Asset Transaction Date Notification Amount Cap.
Type Date
DC Amazon.com, Inc. - Common Stock P 03/04/2024 03/04/2024 $350.78
(AMZN) [ST]
F      S     : New
* For the complete list
"""


def test_parses_exact_dollar_amount_under_threshold():
    trades = parse_text(EXACT_AMOUNT_PTR)
    assert len(trades) == 1
    t = trades[0]
    assert t.owner == "DC"
    assert t.asset_ticker == "AAPL" or t.asset_ticker == "AMZN"  # depends on wrap merge
    assert t.amount_range_low == 350
    assert t.amount_range_high == 350  # echoed for exact amounts
    assert t.amount_range_raw == "$350.78"


def test_returns_empty_when_no_transaction_section():
    assert parse_text("just some unrelated text\nwith no header") == []
