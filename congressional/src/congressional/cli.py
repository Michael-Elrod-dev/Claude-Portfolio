import logging
from pathlib import Path

import httpx
import typer
from dotenv import load_dotenv

# Load congressional/.env for local CLI runs (ANTHROPIC_API_KEY for OCR). A
# no-op in the GitHub Actions workflow, which provides the env directly.
load_dotenv()

from congressional.house.ingest import ingest_year
from congressional.house.ptr_ingest import parse_ptrs_for_year
from congressional.senate.ingest import ingest_year as senate_ingest_year
from congressional.senate.ptr_ingest import (
    parse_ptrs_for_year as senate_parse_ptrs_for_year,
)

app = typer.Typer(
    help="Parse congressional trade disclosures.",
    no_args_is_help=True,
    pretty_exceptions_show_locals=False,
)
house_app = typer.Typer(help="House of Representatives commands.", no_args_is_help=True)
senate_app = typer.Typer(help="Senate commands.", no_args_is_help=True)
app.add_typer(house_app, name="house")
app.add_typer(senate_app, name="senate")

DEFAULT_DATA_DIR = Path("data")


def _require_database_url(process: str) -> None:
    """Fail loudly when DATABASE_URL is missing rather than guessing a database.

    The export workflow sets it to the cached SQLite file
    (sqlite:///data/congressional.db); tests call make_engine with an explicit
    path instead.
    """
    import os

    if "DATABASE_URL" not in os.environ:
        typer.secho(
            f"DATABASE_URL is not set — {process} needs it. Set it, e.g. "
            "DATABASE_URL=sqlite:///data/congressional.db",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)


@house_app.command("ingest")
def house_ingest(
    year: int = typer.Argument(..., help="Disclosure year, e.g. 2024."),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Where ZIPs, extracted files, and the SQLite DB are stored.",
    ),
    force_download: bool = typer.Option(
        False,
        "--force-download",
        help="Re-download the ZIP even if cached.",
    ),
) -> None:
    """Download, extract, parse, and store one year of House disclosures."""
    typer.echo(f"Ingesting House disclosures for {year}...")
    try:
        result = ingest_year(year, data_dir, force_download=force_download)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            typer.secho(
                f"Error: no disclosure ZIP found for year {year} "
                f"(404 at {e.request.url}). The House Clerk only publishes "
                f"recent years.",
                fg=typer.colors.RED,
                err=True,
            )
        else:
            typer.secho(
                f"Error fetching disclosure ZIP for {year}: "
                f"HTTP {e.response.status_code} at {e.request.url}",
                fg=typer.colors.RED,
                err=True,
            )
        raise typer.Exit(code=1) from None
    typer.echo(f"  ZIP:               {result.zip_path}")
    typer.echo(f"  XML:               {result.xml_path}")
    typer.echo(f"  DB:                {result.db_path}")
    typer.echo(f"  Records seen:      {result.records_seen}")
    typer.echo(f"  Records inserted:  {result.records_inserted}")
    skipped = result.records_seen - result.records_inserted
    if skipped:
        typer.echo(f"  Skipped (already in DB): {skipped}")


@house_app.command("parse-ptrs")
def house_parse_ptrs(
    year: int = typer.Argument(..., help="Disclosure year, e.g. 2024."),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Where the SQLite DB and cached PDFs live.",
    ),
    limit: int | None = typer.Option(
        None,
        "--limit",
        help="Only attempt the first N PTRs (useful for sampling).",
    ),
    redo: bool = typer.Option(
        False,
        "--redo",
        help="Re-parse PTRs that have already been processed.",
    ),
    retry_scanned: bool = typer.Option(
        False,
        "--retry-scanned",
        help="Re-attempt only image-only 'scanned' filings via the Claude vision "
        "OCR fallback (requires ANTHROPIC_API_KEY).",
    ),
) -> None:
    """Download PTR PDFs for the given year, parse trades, store in SQLite."""
    typer.echo(f"Parsing House PTRs for {year}...")
    result = parse_ptrs_for_year(
        year,
        data_dir,
        limit=limit,
        skip_already_done=not redo,
        retry_scanned=retry_scanned,
    )
    typer.echo(f"  Total PTRs in index:    {result.total_ptrs}")
    typer.echo(f"  Attempted this run:     {result.attempted}")
    typer.echo(f"  Parsed (with trades):   {result.parsed}")
    typer.echo(f"  Scanned (skipped):      {result.scanned}")
    typer.echo(f"  No transactions found:  {result.no_transactions}")
    typer.echo(f"  Errors:                 {result.errors}")
    typer.echo(f"  Trades inserted:        {result.trades_inserted}")
    if result.error_samples:
        typer.echo("\n  First few errors:")
        for doc_id, msg in result.error_samples:
            typer.echo(f"    {doc_id}: {msg}")


@senate_app.command("ingest")
def senate_ingest(
    year: int = typer.Argument(..., help="Disclosure year, e.g. 2024."),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Where the SQLite DB and cached HTML live.",
    ),
) -> None:
    """Search efdsearch.senate.gov for senator PTRs in the given year and persist them."""
    typer.echo(f"Searching Senate PTRs for {year}...")
    result = senate_ingest_year(year, data_dir)
    typer.echo(f"  DB:                 {result.db_path}")
    typer.echo(f"  Records seen:       {result.records_seen}")
    typer.echo(f"  Records inserted:   {result.records_inserted}")
    skipped = result.records_seen - result.records_inserted
    if skipped:
        typer.echo(f"  Skipped (already in DB): {skipped}")


@senate_app.command("parse-ptrs")
def senate_parse_ptrs(
    year: int = typer.Argument(..., help="Disclosure year, e.g. 2024."),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Where the SQLite DB and cached HTML live.",
    ),
    limit: int | None = typer.Option(
        None,
        "--limit",
        help="Only attempt the first N PTRs (useful for sampling).",
    ),
    redo: bool = typer.Option(
        False,
        "--redo",
        help="Re-parse PTRs that have already been processed.",
    ),
    retry_paper: bool = typer.Option(
        False,
        "--retry-paper",
        help="Re-attempt only image-only 'paper' filings via the Claude vision "
        "OCR fallback (requires ANTHROPIC_API_KEY).",
    ),
) -> None:
    """Fetch each Senate e-file PTR's HTML and extract trades into SQLite."""
    typer.echo(f"Parsing Senate PTRs for {year}...")
    result = senate_parse_ptrs_for_year(
        year,
        data_dir,
        limit=limit,
        skip_already_done=not redo,
        retry_paper=retry_paper,
    )
    typer.echo(f"  Total PTRs in index:    {result.total_ptrs}")
    typer.echo(f"  Attempted this run:     {result.attempted}")
    typer.echo(f"  Parsed (with trades):   {result.parsed}")
    typer.echo(f"  Paper (skipped):        {result.paper_skipped}")
    typer.echo(f"  No transactions found:  {result.no_transactions}")
    typer.echo(f"  Errors:                 {result.errors}")
    typer.echo(f"  Trades inserted:        {result.trades_inserted}")
    if result.error_samples:
        typer.echo("\n  First few errors:")
        for doc_id, msg in result.error_samples:
            typer.echo(f"    {doc_id}: {msg}")


@app.command("enrich-filers")
def enrich_filers(
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Directory containing the SQLite DB (ignored when DATABASE_URL is set).",
    ),
) -> None:
    """Materialize per-filer party / gender / committee into filer_enrichment.

    Resolves every distinct filer against the congress-legislators dataset (the
    same logic the Politicians page uses) so /v1/trades can filter by party,
    gender, and committee. Near-static; re-run after ingesting new filers.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    from congressional.db import make_engine
    from congressional.enrich_filers import refresh_filer_enrichment

    engine = make_engine(data_dir / "congressional.db")
    n = refresh_filer_enrichment(engine)
    typer.echo(f"  Filers enriched: {n}")


@app.command("rebuild-read-model")
def rebuild_read_model_cmd(
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Directory containing the SQLite DB (ignored when DATABASE_URL is set).",
    ),
) -> None:
    """Rebuild the read model (politician_stats).

    The poller does this automatically after any ingest; run it by hand after a
    manual parse or bulk data change.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    from congressional.db import make_engine
    from congressional.read_model import rebuild_read_model

    engine = make_engine(data_dir / "congressional.db")
    counts = rebuild_read_model(engine)
    typer.echo(f"  Politicians: {counts['politicians']}")


@app.command("poll")
def poll(
    year: int | None = typer.Option(
        None,
        "--year",
        help="Pin a single disclosure year. Default: current year, plus the "
        "previous year through Q1 (rolls over automatically).",
    ),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Where the SQLite DB, ZIPs, and poll state file are stored.",
    ),
) -> None:
    """Run one poll cycle: ingest any new House/Senate filings, then refresh
    filer enrichment and rebuild the read model if anything new landed.
    """
    import datetime

    from congressional.poller import _PollState, poll_once, years_to_poll

    _require_database_url("the poller")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    years = [year] if year else years_to_poll(datetime.date.today())
    typer.echo(f"Running single poll cycle for {years}...")
    state = _PollState(data_dir / "poll_state.json")
    found, _error = poll_once(years, data_dir, state)
    if found:
        from congressional.db import make_engine
        from congressional.enrich_filers import refresh_filer_enrichment
        from congressional.read_model import rebuild_read_model

        engine = make_engine(data_dir / "congressional.db")
        refresh_filer_enrichment(engine)
        rebuild_read_model(engine)
        typer.echo("New data ingested; read model rebuilt.")
    else:
        typer.echo("No new data.")


@app.command("export")
def export_cmd(
    out: Path = typer.Option(..., "--out", help="Path to write the JSON snapshot."),
    window_days: int = typer.Option(
        14,
        "--window-days",
        help="Export trades filed within this many days (default 14 — double the "
        "bot's 7-day lookback, so its window always has margin).",
    ),
    data_dir: Path = typer.Option(
        DEFAULT_DATA_DIR,
        "--data-dir",
        help="Directory containing the SQLite DB (ignored when DATABASE_URL is set).",
    ),
) -> None:
    """Write the snapshot the trading bot's CongressionalSource reads."""
    from congressional.db import make_engine
    from congressional.export import write_snapshot

    engine = make_engine(data_dir / "congressional.db")
    n_trades, n_pols = write_snapshot(engine, out, window_days=window_days)
    typer.echo(f"Exported {n_trades} trades, {n_pols} politicians -> {out}")
