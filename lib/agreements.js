// WP-SIGNUP: tier definitions, term math, and the agreement document templates.
// The templates render full standalone HTML documents (navy/gold/cream brand,
// print-ready). At signing time the rendered HTML is snapshotted onto the
// agreements row so the signed record never drifts when a template changes.
//
// LEGAL NOTE: every document rendered here is a plain-English draft. Each one
// carries a "DRAFT FOR ATTORNEY REVIEW" note in its footer. That note is part
// of the recorded document; it does not block signup.

export const TERM_OPTIONS = [6, 12, 24, 36]; // months

export const TIERS = {
  consulting: {
    key: 'consulting',
    label: 'HAB Consulting',
    docTitle: 'Consulting Services Agreement',
    gp_fee_pct: 5,      // % of monthly gross profit dollars
    mgmt_fee_pct: null,
    equity_pct: null,
    summary: '5% of monthly gross profit dollars. Full Academy access for your whole team.',
  },
  portfolio: {
    key: 'portfolio',
    label: 'HAB Portfolio',
    docTitle: 'HAB Portfolio Package Agreement',
    gp_fee_pct: null,
    mgmt_fee_pct: 2.5,  // % of monthly gross profit
    equity_pct: 10,     // SAFE equity stake
    summary: '10% equity stake to HAB via SAFE, 2.5% of gross profit management fee, and War Chest rules with a 90/5/5 quarterly split.',
  },
};

export const BOOK_PRICE_CENTS = 6500; // $65 per printed copy (see routes/orders.js)

// start: 'YYYY-MM-DD'. Returns 'YYYY-MM-DD' after adding months (UTC-safe).
export function computeEndDate(startISO, months) {
  const [y, m, d] = startISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp month-end rollover (e.g. Jan 31 + 1 month -> Feb 28/29, not Mar 3).
  if (dt.getUTCDate() !== d) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// ===== Shared document chrome =====

function docShell({ title, eyebrow, bodyHtml, signedBlock, pendingBanner }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · HAB Enterprises 3 LLC</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1A1A1A; background: #F8F9FB; line-height: 1.6; }
  .doc { max-width: 760px; margin: 0 auto; background: #FFFFFF; border: 1px solid #F0E2BE; }
  .masthead { background: #112341; color: #FFFFFF; padding: 26px 40px; border-bottom: 5px solid #C8A75C; }
  .masthead .eyebrow { font-size: 10px; letter-spacing: 5px; color: #C8A75C; font-weight: 700; text-transform: uppercase; }
  .masthead h1 { font-family: Georgia, serif; font-size: 27px; margin: 6px 0 0; font-weight: 800; letter-spacing: -0.5px; }
  .banner { background: #C8A75C; color: #112341; font-weight: 800; letter-spacing: 3px; font-size: 12px; text-align: center; padding: 9px 16px; text-transform: uppercase; }
  .body { padding: 30px 40px 10px; }
  h2 { font-family: Georgia, serif; color: #112341; font-size: 17px; margin: 26px 0 8px; border-bottom: 2px solid #C8A75C; padding-bottom: 4px; }
  h2 .no { color: #A78743; margin-right: 8px; }
  p, li { font-size: 14px; }
  ul, ol { padding-left: 22px; }
  .recital { font-style: italic; font-family: Georgia, serif; color: #1B3358; }
  .callout { background: #FAF4E4; border-left: 4px solid #C8A75C; padding: 12px 18px; margin: 14px 0; font-size: 14px; }
  table.terms { width: 100%; border-collapse: collapse; margin: 12px 0 4px; font-size: 14px; }
  table.terms th { background: #1B3358; color: #FFFFFF; text-align: left; padding: 8px 12px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
  table.terms td { border-bottom: 1px solid #F0E2BE; padding: 8px 12px; vertical-align: top; }
  table.terms td:first-child { font-weight: 700; color: #1B3358; white-space: nowrap; }
  .sig { margin: 30px 0 10px; padding: 18px 22px; border: 1px solid #DDD3B8; background: #FAF4E4; }
  .sig .sig-name { font-family: Georgia, serif; font-size: 22px; font-style: italic; color: #112341; border-bottom: 1px solid #112341; display: inline-block; min-width: 320px; padding: 2px 6px; }
  .sig .sig-meta { font-size: 12px; color: #555; margin-top: 8px; }
  .footer { margin-top: 26px; background: #112341; color: #FAF4E4; padding: 16px 40px; font-size: 11px; text-align: center; border-top: 4px solid #C8A75C; }
  .footer .draft { color: #C8A75C; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; font-size: 11px; }
  .footer .co { font-style: italic; margin-top: 4px; }
  @media print { body { background: #fff; } .doc { border: none; } }
</style>
</head>
<body>
<div class="doc">
  <div class="masthead">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1>${esc(title)}</h1>
  </div>
  ${pendingBanner ? `<div class="banner">${esc(pendingBanner)}</div>` : ''}
  <div class="body">
    ${bodyHtml}
    ${signedBlock}
  </div>
  <div class="footer">
    <div class="draft">Draft for attorney review</div>
    <div>This document is a plain-English draft prepared for attorney review and has not been reviewed by legal counsel.</div>
    <div class="co">Draft for attorney review. HAB Enterprises 3 LLC.</div>
  </div>
</div>
</body>
</html>`;
}

function signatureBlock({ signedName, signedAt, ip, ownerName, shopName, counterparty }) {
  if (!signedName) {
    return `<div class="sig">
      <div style="font-size:11px; letter-spacing:2px; font-weight:700; color:#1B3358; text-transform:uppercase;">Signature</div>
      <p style="font-size:13px; color:#555;">This document has not been signed yet. To sign, the Owner types their full legal name and confirms agreement on the signup page.</p>
    </div>`;
  }
  return `<div class="sig">
    <div style="font-size:11px; letter-spacing:2px; font-weight:700; color:#1B3358; text-transform:uppercase;">Signed electronically by the Owner</div>
    <div class="sig-name">${esc(signedName)}</div>
    <div class="sig-meta">
      ${esc(ownerName)} for ${esc(shopName)}<br>
      Signed at: ${esc(signedAt)} (UTC)${ip ? ` · IP address: ${esc(ip)}` : ''}<br>
      Signature method: click-wrap acceptance with typed full-name signature recorded by the HAB Academy platform.
    </div>
    ${counterparty ? `<div class="sig-meta" style="margin-top:12px; border-top:1px dashed #DDD3B8; padding-top:10px;">
      <strong>HAB Enterprises 3 LLC:</strong> ${esc(counterparty)}
    </div>` : ''}
  </div>`;
}

// ===== Consulting Services Agreement (default tier) =====

export function renderConsultingAgreement(a) {
  const { shopName, orgName, ownerName, ownerEmail, termMonths, startDate, endDate } = a;
  const body = `
<p class="recital">This Consulting Services Agreement (the "Agreement") is entered into as of ${esc(prettyDate(startDate))} between <strong>HAB Enterprises 3 LLC</strong> ("HAB") and <strong>${esc(shopName)}</strong>${orgName && orgName !== shopName ? `, part of ${esc(orgName)},` : ''} (the "Shop"), represented by ${esc(ownerName)} (the "Owner").</p>

<h2><span class="no">1.</span>Purpose</h2>
<p>HAB operates the Healthy Auto Business Sales Operating System and the HAB Academy training platform. The Shop wants to raise its sales performance, customer trust, and gross profit using HAB's system, coaching materials, and tools. This Agreement sets out the terms of that engagement in plain English.</p>

<h2><span class="no">2.</span>Services and Access License</h2>
<p>During the Term, HAB grants the Shop a non-exclusive, non-transferable license for the Owner and the Shop's enrolled team members to access:</p>
<ul>
  <li>The HAB Academy curriculum (Modules 1 through 9), including scripts, drills, and mastery tracking.</li>
  <li>The HAB book library in the browser, including the Advisor Book, the Script Book, and, for owners and coaches, the Coach's Book.</li>
  <li>Audio editions of the books as they become available.</li>
  <li>Team progress tools: leaderboards, check-ins, mastery levels, and coaching dashboards.</li>
  <li>The option to order printed copies of the HAB books at the then-current price per copy.</li>
</ul>
<p>Access is licensed per shop, for the Shop's active team members only, and only while this Agreement is active.</p>

<h2><span class="no">3.</span>Consulting Fee</h2>
<div class="callout"><strong>Fee: 5% of the Shop's monthly gross profit dollars.</strong> The fee is calculated on the Shop's gross profit for each calendar month and is due within 15 days after the end of that month. The Shop will provide HAB reasonable documentation of monthly gross profit on request.</div>

<h2><span class="no">4.</span>Term</h2>
<table class="terms">
  <tr><th colspan="2">Agreement Term</th></tr>
  <tr><td>Term length</td><td>${termMonths} months</td></tr>
  <tr><td>Start date</td><td>${esc(prettyDate(startDate))}</td></tr>
  <tr><td>End date</td><td>${esc(prettyDate(endDate))}</td></tr>
</table>
<p>The Agreement ends automatically on the end date unless renewed in writing (a renewal signed through the platform counts as writing).</p>

<h2><span class="no">5.</span>Termination and Access Cutoff</h2>
<p>When this Agreement expires or is terminated for any reason:</p>
<ul>
  <li>Platform access ends for the Owner and every team member of the Shop. There is no wind-down access period.</li>
  <li>Fees accrued through the end date remain due.</li>
  <li>Printed books already purchased remain the Shop's property, subject to the intellectual property terms below.</li>
</ul>

<h2><span class="no">6.</span>Intellectual Property Protection</h2>
<p>The HAB books, curriculum, scripts, posters, recordings, and all other HAB materials are and remain the exclusive property of HAB. The Shop agrees that it and its team members will not:</p>
<ul>
  <li>Download, copy, scrape, photograph, or otherwise reproduce HAB materials from the platform.</li>
  <li>Share logins, distribute materials to anyone outside the Shop's enrolled team, or use the materials to build a competing program.</li>
  <li>Retain digital copies of HAB materials after the Agreement ends.</li>
</ul>
<p>Digital materials are provided for in-browser use only. Printed books are available for purchase and remain licensed for the Shop's internal training use.</p>

<h2><span class="no">7.</span>General</h2>
<ul>
  <li>Each party is an independent contractor; nothing here creates a partnership, joint venture, or employment relationship.</li>
  <li>Neither party is liable for indirect or consequential damages. HAB's total liability is capped at the fees paid in the three months before the claim.</li>
  <li>This Agreement is the entire agreement on its subject and can be amended only in a writing accepted by both parties.</li>
  <li>Signing electronically on the HAB Academy platform, including where a separate paper agreement also exists, is intended by both parties to create a binding record of acceptance.</li>
</ul>

<h2><span class="no">8.</span>Parties</h2>
<table class="terms">
  <tr><th>Party</th><th>Details</th></tr>
  <tr><td>HAB</td><td>HAB Enterprises 3 LLC ("HAB"), provider of the Healthy Auto Business Sales Operating System</td></tr>
  <tr><td>Shop</td><td>${esc(shopName)}${orgName && orgName !== shopName ? ` (${esc(orgName)})` : ''}</td></tr>
  <tr><td>Owner</td><td>${esc(ownerName)} · ${esc(ownerEmail)}</td></tr>
</table>`;
  return docShell({
    title: 'Consulting Services Agreement',
    eyebrow: 'HAB Enterprises 3 LLC · Healthy Auto Business',
    bodyHtml: body,
    signedBlock: signatureBlock({ ...a, counterparty: 'Accepted by countersignature or by commencement of services.' }),
  });
}

// ===== HAB Portfolio Package (private equity deal tier) =====

export function renderPortfolioAgreement(a) {
  const { shopName, orgName, ownerName, ownerEmail, termMonths, startDate, endDate } = a;
  const body = `
<p class="recital">This HAB Portfolio Package Agreement (the "Agreement") is entered into as of ${esc(prettyDate(startDate))} between <strong>HAB Enterprises 3 LLC</strong> ("HAB") and <strong>${esc(shopName)}</strong>${orgName && orgName !== shopName ? `, part of ${esc(orgName)},` : ''} (the "Company"), represented by ${esc(ownerName)} (the "Owner").</p>

<p class="recital">The Company and HAB share a long-term goal: build a disciplined, profitable shop with a growing capital reserve, positioned for a premium private equity exit as part of a larger roll-up. This Agreement puts that playbook in writing: HAB takes an equity stake and an active management role, the owners keep taking profits, and a protected War Chest compounds inside the Company toward the exit.</p>

<h2><span class="no">1.</span>Package Structure</h2>
<p>The HAB Portfolio Package has three parts, all of which take effect together:</p>
<ol>
  <li><strong>SAFE (Simple Agreement for Future Equity):</strong> the Company grants HAB a 10% equity stake under the SAFE instrument generated with this Agreement (attached to the Company's record and marked pending HAB countersignature).</li>
  <li><strong>Management Services Agreement:</strong> HAB provides active management services for a fee of 2.5% of the Company's monthly gross profit.</li>
  <li><strong>War Chest and Distributions Rider:</strong> the quarterly profit split and War Chest governance rules in Section 4.</li>
</ol>

<h2><span class="no">2.</span>Management Services and Academy Access</h2>
<p>During the Term, HAB provides the Company:</p>
<ul>
  <li>Active management support: sales operating system installation, KPI reviews, coaching cadence, and hiring and promotion guidance.</li>
  <li>Full HAB Academy access for the Owner and the Company's enrolled team members: curriculum, book library in the browser, audio editions as available, leaderboards, and coaching dashboards.</li>
  <li>The option to order printed copies of the HAB books at the then-current price per copy.</li>
</ul>

<h2><span class="no">3.</span>Management Fee</h2>
<div class="callout"><strong>Fee: 2.5% of the Company's monthly gross profit.</strong> The fee is calculated on the Company's gross profit for each calendar month and is due within 15 days after the end of that month.</div>

<h2><span class="no">4.</span>War Chest and Distributions Rider</h2>
<p><strong>4.1 Quarterly distributions.</strong> The owners of the Company take profits quarterly, based on the Company's quarterly profit and loss statement. Each quarter, the Company's distributable profit is split as follows:</p>
<table class="terms">
  <tr><th>Share</th><th>Goes to</th></tr>
  <tr><td>90%</td><td>The owners, in proportion to their profit entitlement. Owners are entitled to 90% of what would otherwise be their full profit entitlement.</td></tr>
  <tr><td>5%</td><td>HAB, paid quarterly.</td></tr>
  <tr><td>5%</td><td>Retained in the Company in a designated reserve account: the <strong>War Chest</strong>.</td></tr>
</table>
<p><strong>4.2 War Chest purpose.</strong> The War Chest is the Company's capital stash for growth and for maximizing the Company's value at a future private equity exit. It compounds inside the business.</p>
<p><strong>4.3 War Chest governance.</strong></p>
<ul>
  <li>If the Company has two owners, <strong>both owners must vote yes</strong> before any funds leave the War Chest.</li>
  <li>If the Company has three or more owners, a <strong>majority vote</strong> of the owners is required before any funds leave the War Chest.</li>
  <li>War Chest funds may <strong>never</strong> be used for owner disbursements or distributions of any kind. They may only be used for reinvestment into the business or for business expenses.</li>
</ul>

<h2><span class="no">5.</span>Equity Grant (SAFE)</h2>
<p>Concurrently with this Agreement, the Company issues HAB a SAFE granting HAB a 10% equity stake in the Company. The SAFE is generated by the platform, stored with this Agreement, and is marked <strong>PENDING HAB COUNTERSIGNATURE</strong> until countersigned by HAB. The Company will take any corporate steps reasonably needed to give effect to the SAFE.</p>

<h2><span class="no">6.</span>Term</h2>
<table class="terms">
  <tr><th colspan="2">Agreement Term</th></tr>
  <tr><td>Term length</td><td>${termMonths} months</td></tr>
  <tr><td>Start date</td><td>${esc(prettyDate(startDate))}</td></tr>
  <tr><td>End date</td><td>${esc(prettyDate(endDate))}</td></tr>
</table>
<p>The management services and Academy access term ends automatically on the end date unless renewed in writing. The SAFE and any equity issued under it survive the end of the Term per the SAFE's own terms.</p>

<h2><span class="no">7.</span>Termination and Access Cutoff</h2>
<ul>
  <li>When the Term expires or the Agreement is terminated, platform access ends for the Owner and every team member of the Company. There is no wind-down access period.</li>
  <li>Fees accrued through the end date remain due. The 90/5/5 quarterly split applies through the last full quarter of the Term.</li>
  <li>The SAFE survives per its terms.</li>
</ul>

<h2><span class="no">8.</span>Intellectual Property Protection</h2>
<p>The HAB books, curriculum, scripts, posters, recordings, and all other HAB materials remain the exclusive property of HAB. The Company and its team members will not download, copy, reproduce, or distribute HAB materials; digital materials are for in-browser use only, and printed books are available for purchase for internal training use. No digital copies may be retained after the Term ends.</p>

<h2><span class="no">9.</span>General</h2>
<ul>
  <li>Each party is an independent contractor; this Agreement does not itself create a partnership or employment relationship.</li>
  <li>Neither party is liable for indirect or consequential damages. HAB's total liability under the management services portion is capped at the management fees paid in the three months before the claim.</li>
  <li>This Agreement, together with the SAFE, is the entire agreement on its subject and can be amended only in a writing accepted by both parties.</li>
  <li>Signing electronically on the HAB Academy platform, including where a separate paper agreement also exists, is intended by both parties to create a binding record of acceptance.</li>
</ul>

<h2><span class="no">10.</span>Parties</h2>
<table class="terms">
  <tr><th>Party</th><th>Details</th></tr>
  <tr><td>HAB</td><td>HAB Enterprises 3 LLC ("HAB")</td></tr>
  <tr><td>Company</td><td>${esc(shopName)}${orgName && orgName !== shopName ? ` (${esc(orgName)})` : ''}</td></tr>
  <tr><td>Owner</td><td>${esc(ownerName)} · ${esc(ownerEmail)}</td></tr>
</table>`;
  return docShell({
    title: 'HAB Portfolio Package Agreement',
    eyebrow: 'HAB Enterprises 3 LLC · Portfolio Tier',
    bodyHtml: body,
    signedBlock: signatureBlock({ ...a, counterparty: 'Management terms accepted by countersignature or by commencement of services. The attached SAFE requires HAB countersignature.' }),
  });
}

// ===== SAFE instrument (portfolio tier, generated with the agreement) =====

export function renderSafe(a) {
  const { shopName, ownerName, startDate } = a;
  const body = `
<p class="recital">This SAFE (Simple Agreement for Future Equity) is issued as of ${esc(prettyDate(startDate))} by <strong>${esc(shopName)}</strong> (the "Company") to <strong>HAB Enterprises 3 LLC</strong> ("HAB" or the "Investor") as part of the HAB Portfolio Package.</p>

<h2><span class="no">1.</span>Equity Stake</h2>
<div class="callout"><strong>The Company grants HAB a 10% equity stake in the Company.</strong> On the earliest of an equity financing, a change of control, or a direct issuance agreed by the parties, the Company will issue HAB equity representing 10% of the Company's fully diluted ownership, on the terms customary for the Company's entity type.</div>

<h2><span class="no">2.</span>Consideration</h2>
<p>HAB's consideration is its ongoing management services, sales operating system, and training platform provided to the Company under the HAB Portfolio Package Agreement of the same date.</p>

<h2><span class="no">3.</span>Distributions: the 90/5/5 Quarterly Split</h2>
<p>For as long as the HAB Portfolio Package is in effect, the Company distributes profits quarterly per its profit and loss statement, split as follows:</p>
<table class="terms">
  <tr><th>Share</th><th>Goes to</th></tr>
  <tr><td>90%</td><td>The Company's owners, in proportion to their profit entitlement (owners are entitled to 90% of their full profit entitlement).</td></tr>
  <tr><td>5%</td><td>HAB, paid quarterly.</td></tr>
  <tr><td>5%</td><td>Retained in the Company's War Chest reserve.</td></tr>
</table>

<h2><span class="no">4.</span>War Chest Covenants</h2>
<ul>
  <li>The War Chest is a designated capital reserve held inside the Company to build value toward a private equity exit.</li>
  <li>With two owners, both owners must vote yes before any funds leave the War Chest. With three or more owners, a majority vote of the owners is required.</li>
  <li>War Chest funds may never be used for owner disbursements or distributions. They may only be used for reinvestment into the business or for business expenses.</li>
</ul>

<h2><span class="no">5.</span>Voting</h2>
<p>Equity issued to HAB under this SAFE carries the same voting rights as the Company's common ownership interests. War Chest decisions follow the owner voting rules in Section 4 above.</p>

<h2><span class="no">6.</span>General</h2>
<ul>
  <li>This SAFE is not a debt instrument, carries no interest, and has no maturity date.</li>
  <li>This SAFE may not be transferred by either party without the other party's written consent, except by HAB to an affiliate.</li>
  <li>This SAFE becomes effective when countersigned by HAB. Until then it is recorded as pending HAB countersignature.</li>
</ul>

<h2><span class="no">7.</span>Parties</h2>
<table class="terms">
  <tr><th>Party</th><th>Details</th></tr>
  <tr><td>Company</td><td>${esc(shopName)}, represented by ${esc(ownerName)}</td></tr>
  <tr><td>Investor</td><td>HAB Enterprises 3 LLC</td></tr>
</table>`;
  return docShell({
    title: 'SAFE: Simple Agreement for Future Equity',
    eyebrow: 'HAB Enterprises 3 LLC · Portfolio Tier · Equity Instrument',
    bodyHtml: body,
    pendingBanner: 'Pending HAB Countersignature',
    signedBlock: signatureBlock({ ...a, counterparty: 'PENDING HAB COUNTERSIGNATURE. This SAFE takes effect when countersigned by HAB Enterprises 3 LLC.' }),
  });
}

// Render the right agreement document for a tier.
export function renderAgreementHtml(tierKey, args) {
  return tierKey === 'portfolio' ? renderPortfolioAgreement(args) : renderConsultingAgreement(args);
}
