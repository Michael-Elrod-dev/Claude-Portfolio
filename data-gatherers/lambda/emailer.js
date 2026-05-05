'use strict';

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const REGION = process.env.AWS_REGION || 'us-east-1';

class Emailer {
  constructor(email) {
    if (!email) throw new Error('Emailer requires a notification email address');
    this.email = email;
    this.ses = new SESClient({ region: REGION });
  }

  async sendRunSummary({ runDate, dryRun, execResult, positions, analystSummary }) {
    const executed = (execResult.results || []).filter((r) => r.status === 'executed' || r.status === 'dry_run' || r.status === 'already_submitted');
    const failed = (execResult.results || []).filter((r) => r.status === 'failed');
    const skipped = (execResult.results || []).filter((r) => r.status === 'skipped');

    const modeTag = dryRun ? ' (DRY RUN)' : '';
    const tradeCount = (execResult.summary?.executed ?? 0) + (execResult.summary?.alreadySubmitted ?? 0);
    const subject = tradeCount > 0
      ? `Claude Portfolio: ${tradeCount} Trade(s) Executed${modeTag} — ${runDate}`
      : `Claude Portfolio: No Trades This Run${modeTag} — ${runDate}`;

    const tradesSection = this._tradesSection(execResult.results || [], dryRun);
    const failedSection = failed.length > 0 ? this._failedSection(failed) : '';
    const skippedSection = skipped.length > 0 ? this._skippedSection(skipped) : '';
    const summarySection = analystSummary
      ? `<div style="background:#16213e;border-left:3px solid #00d4ff;padding:12px 16px;margin-bottom:24px;border-radius:0 4px 4px 0">
           <p style="margin:0;color:#ccc;font-style:italic">${_esc(analystSummary)}</p>
         </div>`
      : '';
    const portfolioSection = this._portfolioSection(positions);

    const body = `
      <h1 style="color:#00d4ff;font-size:22px;margin-bottom:4px">Claude Portfolio Trader</h1>
      <p style="color:#666;margin-top:0">${runDate}${modeTag}</p>

      ${summarySection}
      ${tradesSection}
      ${failedSection}
      ${skippedSection}
      ${portfolioSection}
    `;

    await this._send(subject, body);
  }

  async sendErrorAlert(runDate, error) {
    const subject = `Claude Portfolio: ERROR — ${runDate}`;
    const body = `
      <h2 style="color:#ff4444">Pipeline Error</h2>
      <pre style="background:#16213e;padding:16px;border-radius:4px;
                  color:#ff8888;overflow-x:auto;font-size:13px;white-space:pre-wrap">${_esc(String(error?.stack || error))}</pre>
    `;
    await this._send(subject, body);
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  _tradesSection(results, dryRun) {
    const relevant = results.filter((r) => r.status === 'executed' || r.status === 'dry_run');
    if (relevant.length === 0) {
      return `<div style="margin-bottom:24px">
        <h2 style="color:#aaa">No Trades Executed</h2>
        <p style="color:#666">All recommendations were skipped or the analyst made no trades this run.</p>
      </div>`;
    }

    const headerColor = dryRun ? '#ffaa00' : '#00ff88';
    const heading = dryRun ? 'Trades (Dry Run — Not Submitted)' : 'Trades Executed ✓';
    const statusLabel = { executed: '✓ filled', dry_run: 'dry run', already_submitted: '↩ prior run' };
    const rows = relevant.map((r) => {
      const rec = r.recommendation || {};
      const side = rec.action || '?';
      const sideColor = side === 'buy' ? '#00ff88' : '#ff4444';
      const amt = rec.amount || {};
      const amtStr = amt.type === 'dollars'
        ? `$${Number(amt.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : amt.type === 'percent'
          ? `${amt.value}%`
          : `${amt.value} shares`;
      const confidence = rec.confidence || '—';
      const confColor = confidence === 'high' ? '#00ff88' : confidence === 'medium' ? '#ffaa00' : '#aaa';
      const statusStr = statusLabel[r.status] || r.status;
      const statusColor = r.status === 'executed' ? '#00ff88' : r.status === 'already_submitted' ? '#00d4ff' : '#ffaa00';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #222"><b>${_esc(rec.ticker || '?')}</b></td>
        <td style="padding:8px 12px;border-bottom:1px solid #222;color:${sideColor}">${side.toUpperCase()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #222">${amtStr}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #222;color:${statusColor}">${statusStr}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #222;color:${confColor}">${confidence}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #222;color:#aaa;font-size:12px">${_esc(rec.rationale || '')}</td>
      </tr>`;
    }).join('\n');

    const headers = ['Ticker', 'Action', 'Amount', 'Status', 'Confidence', 'Rationale'];
    const ths = headers.map((h) =>
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid ${headerColor};color:${headerColor}">${h}</th>`
    ).join('');

    return `<div style="margin-bottom:24px">
      <h2 style="color:${headerColor}">${heading}</h2>
      <table style="width:100%;border-collapse:collapse;background:#16213e">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  _failedSection(failed) {
    const rows = failed.map((r) => {
      const rec = r.recommendation || {};
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #222"><b>${_esc(rec.ticker || '?')}</b></td>
        <td style="padding:6px 12px;border-bottom:1px solid #222;color:#ff4444">${_esc(r.reason || '')}</td>
      </tr>`;
    }).join('\n');

    const ths = ['Ticker', 'Error'].map((h) =>
      `<th style="padding:6px 12px;text-align:left;border-bottom:2px solid #ff4444;color:#ff4444">${h}</th>`
    ).join('');

    return `<div style="margin-bottom:24px">
      <h3 style="color:#ff4444">Failed Orders (${failed.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#16213e">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  _skippedSection(skipped) {
    const rows = skipped.map((r) => {
      const rec = r.recommendation || {};
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #222">${_esc(rec.ticker || '?')}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #222;color:#666">${_esc(r.reason || '')}</td>
      </tr>`;
    }).join('\n');

    const ths = ['Ticker', 'Reason'].map((h) =>
      `<th style="padding:6px 12px;text-align:left;border-bottom:2px solid #555;color:#888">${h}</th>`
    ).join('');

    return `<div style="margin-bottom:24px">
      <h3 style="color:#888">Skipped (${skipped.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#16213e">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  _portfolioSection(positions) {
    if (!positions || positions.length === 0) {
      return `<div style="margin-bottom:24px">
        <h3 style="color:#ccc">Current Positions</h3>
        <p style="color:#666">No open positions.</p>
      </div>`;
    }

    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const rows = positions.map((p) => {
      const pnl = p.unrealizedPl || 0;
      const pnlPct = p.unrealizedPlPct != null ? Number(p.unrealizedPlPct) * 100 : null;
      const pnlColor = pnl >= 0 ? '#00ff88' : '#ff4444';
      const pnlStr = pnlPct != null
        ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`
        : `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}`;
      const pct = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0;
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #222"><b>${_esc(p.symbol)}</b></td>
        <td style="padding:6px 12px;border-bottom:1px solid #222">${Number(p.qty).toFixed(4)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #222">$${Number(p.marketValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #222">${pct.toFixed(1)}%</td>
        <td style="padding:6px 12px;border-bottom:1px solid #222;color:${pnlColor}">${pnlStr}</td>
      </tr>`;
    }).join('\n');

    const ths = ['Ticker', 'Qty', 'Market Value', 'Portfolio %', 'Unrealized P&L'].map((h) =>
      `<th style="padding:6px 12px;text-align:left;border-bottom:2px solid #00d4ff;color:#00d4ff">${h}</th>`
    ).join('');

    return `<div style="margin-bottom:24px">
      <h3 style="color:#ccc">Current Positions — Total: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
      <table style="width:100%;border-collapse:collapse;background:#16213e">
        <thead><tr>${ths}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  async _send(subject, bodyContent) {
    const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#1a1a2e;color:#e0e0e0;
                   padding:32px;max-width:750px;margin:0 auto">
${bodyContent}
<hr style="border-color:#333;margin-top:32px">
<p style="color:#555;font-size:11px">Claude Portfolio Trader — automated paper trading system</p>
</body></html>`;

    await this.ses.send(new SendEmailCommand({
      Source: this.email,
      Destination: { ToAddresses: [this.email] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    }));
  }
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = Emailer;
