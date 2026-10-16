from datetime import date

from congressional.senate.html_parser import (
    _parse_amount_bounds,
    _parse_owner,
    _parse_transaction_type,
    parse_ptr_html,
)


def test_owner_label_mapping():
    # Explicit Self is preserved (the API shows NULL as "Undisclosed").
    assert _parse_owner("Self") == "SELF"
    assert _parse_owner("Spouse") == "SP"
    assert _parse_owner("Joint") == "JT"
    assert _parse_owner("Dependent Child") == "DC"
    assert _parse_owner("Child") == "DC"
    assert _parse_owner("Unknown Label") is None


def test_transaction_type_mapping():
    assert _parse_transaction_type("Purchase") == "P"
    assert _parse_transaction_type("Sale (Full)") == "S"
    assert _parse_transaction_type("Sale (Partial)") == "S (partial)"
    assert _parse_transaction_type("Exchange") == "E"
    # Generic-fallback variants the Senate UI sometimes uses
    assert _parse_transaction_type("Partial Sale") == "S (partial)"
    assert _parse_transaction_type("Mystery Type") is None


def test_amount_bounds_range():
    assert _parse_amount_bounds("$1,001 - $15,000") == (1001, 15000)
    assert _parse_amount_bounds("$100,001 - $250,000") == (100001, 250000)


def test_amount_bounds_over():
    assert _parse_amount_bounds("Over $50,000,000") == (50000000, None)


SENATE_PTR_HTML_FIXTURE = """\
<html><body>
<h2 class="filedReport">The Honorable Test Senator</h2>
<section class="card"><div class="card-body">
<table class="table table-striped">
<thead>
  <tr><th>#</th><th>Transaction Date</th><th>Owner</th><th>Ticker</th>
      <th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th></tr>
</thead>
<tbody>
  <tr>
    <td>1</td><td>07/30/2024</td><td>Spouse</td><td>LRN</td>
    <td>Stride, Inc. Common Stock</td><td>Stock</td><td>Purchase</td>
    <td>$1,001 - $15,000</td><td>LPL19</td>
  </tr>
  <tr>
    <td>2</td><td>12/18/2024</td><td>Self</td><td>--</td>
    <td>U.S. Treasury Bond</td><td>Municipal Security</td><td>Sale (Partial)</td>
    <td>$15,001 - $50,000</td><td></td>
  </tr>
  <tr>
    <td>3</td><td>11/01/2024</td><td>Joint</td><td>NVDA</td>
    <td>NVIDIA Corporation</td><td>Stock</td><td>Sale (Full)</td>
    <td>Over $50,000,000</td><td></td>
  </tr>
</tbody></table></div></section></body></html>
"""


def test_parse_ptr_html_full_fixture():
    trades = parse_ptr_html(SENATE_PTR_HTML_FIXTURE, doc_id="abc-123")
    assert len(trades) == 3

    t1, t2, t3 = trades

    assert t1.doc_id == "abc-123"
    assert t1.line_number == 1
    assert t1.owner == "SP"
    assert t1.asset_ticker == "LRN"
    assert t1.transaction_type == "P"
    assert t1.transaction_date == date(2024, 7, 30)
    assert t1.amount_range_low == 1001
    assert t1.amount_range_high == 15000

    assert t2.owner == "SELF"
    assert t2.asset_ticker is None  # rendered as "--"
    assert t2.transaction_type == "S (partial)"
    assert t2.asset_type == "Municipal Security"

    assert t3.owner == "JT"
    assert t3.transaction_type == "S"
    assert t3.amount_range_low == 50000000
    assert t3.amount_range_high is None


def test_parse_ptr_html_no_table_returns_empty():
    assert parse_ptr_html("<html><body><p>nope</p></body></html>", "x") == []


PAGE_WITHOUT_TBODY = """\
<html><body><table class="table table-striped"><thead><tr><th>Foo</th></tr></thead></table></body></html>
"""


def test_parse_ptr_html_table_without_tbody_returns_empty():
    assert parse_ptr_html(PAGE_WITHOUT_TBODY, "x") == []
