// ─────────────────────────────────────────────────────────────
// THE WATCHMAN — The Digest
// A daily "here's what's due" briefing across all three ministries.
//
// Runs on a GitHub Action (like the Gate). Reads the v_due_now view
// from Supabase (active tasks due today or overdue, hottest first),
// formats it in the Watchman's voice, and sends it via Resend.
//
// Zero npm dependencies — Node 24 has fetch + Intl built in.
// Everything it needs comes from environment (GitHub secrets):
//   SUPABASE_URL                 e.g. https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    (bypasses RLS to read the view)
//   RESEND_API_KEY               (sending access)
//   DIGEST_TO                    where the briefing lands
//   DIGEST_FROM                  verified Resend sender
// Optional:
//   DIGEST_TZ    default 'America/Chicago'
//   DIGEST_HOUR  default '6'  (local hour the scheduled run should fire)
// ─────────────────────────────────────────────────────────────

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY,
  DIGEST_TO,
  DIGEST_FROM,
  DIGEST_TZ = "America/Chicago",
  DIGEST_HOUR = "6",
  GITHUB_EVENT_NAME = "",
} = process.env;

// ── Brand palette (locked) ──────────────────────────────────
const C = {
  base: "#14100D", panel: "#1C1815", raise: "#241F1A", line: "#322B24",
  bone: "#ECE4D5", mute: "#8B8177", signal: "#F2A115", alert: "#C24438",
};

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DIGEST_TO, DIGEST_FROM })) {
  if (!v) die(`Missing required secret: ${k}`);
}

// ── Local time helpers (DST-proof via Intl) ─────────────────
const localParts = (tz) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false, weekday: "short", month: "short",
  });
  // build a lookup from the formatted parts
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p; // { year, month, day, hour, weekday, ... }
};

const tz = DIGEST_TZ;
const now = localParts(tz);
const localHour = parseInt(now.hour, 10);
const isManual = GITHUB_EVENT_NAME === "workflow_dispatch";

// The workflow fires at both 11:00 and 12:00 UTC to cover CST/CDT.
// Only the run that lands on the target local hour actually sends —
// unless you triggered it by hand (then always send, for testing).
if (!isManual && localHour !== parseInt(DIGEST_HOUR, 10)) {
  console.log(`Local hour is ${localHour} in ${tz}; target is ${DIGEST_HOUR}. Standing down.`);
  process.exit(0);
}

// Chicago "today" as YYYY-MM-DD, for honest overdue math.
const todayISO = `${now.year}-${now.month.length === 2 ? now.month : "0" + now.month}-${now.day}`;
const todayLabel = (() => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  return f.format(new Date());
})();

// ── Pull what's due ─────────────────────────────────────────
async function fetchDue() {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/v_due_now?select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    die(`Supabase read failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── Formatting ──────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const daysOver = (dueISO) => {
  const a = Date.parse(todayISO + "T00:00:00Z");
  const b = Date.parse(dueISO + "T00:00:00Z");
  return Math.round((a - b) / 86400000);
};

const prioColor = (p) => (p === "high" ? C.alert : p === "med" ? C.signal : C.mute);

function dueChip(dueISO) {
  const d = daysOver(dueISO);
  if (d > 0) return { txt: `${d}D OVER`, bg: C.alert, fg: "#fff", border: C.alert };
  return { txt: "TODAY", bg: "transparent", fg: C.signal, border: "rgba(242,161,21,.35)" };
}

function rowHtml(t) {
  const chip = dueChip(t.due_date);
  const left = prioColor(t.priority);
  const note = t.note ? `<div style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:${C.mute};margin-top:5px;">${esc(t.note)}</div>` : "";
  const highTag = t.priority === "high"
    ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${C.alert};border:1px solid rgba(194,68,56,.4);border-radius:4px;padding:1px 6px;">HIGH</span>`
    : "";
  const viaGate = t.source === "triage"
    ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${C.mute};border:1px solid ${C.line};border-radius:4px;padding:1px 6px;">via GATE</span>`
    : "";
  return `
  <tr>
    <td style="padding:0 0 8px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${left};border-radius:9px;">
        <tr><td style="padding:13px 14px;">
          <div style="font-family:'Inter',Arial,sans-serif;font-size:15px;line-height:1.35;color:${C.bone};">${esc(t.title)}</div>
          <div style="margin-top:7px;">
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${C.bone};background:${C.raise};border:1px solid ${C.line};border-radius:4px;padding:2px 7px;">${esc(t.brand_short || t.brand_id)}</span>
            ${highTag}
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${chip.fg};background:${chip.bg};border:1px solid ${chip.border};border-radius:4px;padding:2px 7px;">${chip.txt}</span>
            ${viaGate}
          </div>
          ${note}
        </td></tr>
      </table>
    </td>
  </tr>`;
}

function buildEmail(rows) {
  const overdue = rows.filter((r) => daysOver(r.due_date) > 0).length;
  const today = rows.length - overdue;

  const summary = rows.length === 0
    ? "The wall's quiet. Nothing due, nothing over."
    : `${rows.length} standing${overdue ? ` · <span style="color:${C.alert};">${overdue} over the line</span>` : ""}.`;

  const body = rows.length === 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
         <tr><td style="border:1px dashed ${C.line};border-radius:10px;padding:34px 20px;text-align:center;">
           <div style="font-family:'Oswald',Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:15px;color:${C.bone};">Gate clear</div>
           <div style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:${C.mute};margin-top:6px;">No task is due today or overdue. Go do the work in front of you.</div>
         </td></tr>
       </table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(rowHtml).join("")}</table>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=JetBrains+Mono:wght@500&family=Inter:wght@400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.base};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.base};">
  <tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <!-- header -->
      <tr><td style="padding:0 2px 18px 2px;border-bottom:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${C.signal};box-shadow:0 0 10px 1px rgba(242,161,21,.6);vertical-align:middle;"></span>
            <span style="font-family:'Oswald',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.14em;font-size:20px;color:${C.bone};vertical-align:middle;margin-left:10px;">The Watchman</span>
          </td>
          <td align="right" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${C.mute};">${esc(todayLabel).toUpperCase()}</td>
        </tr></table>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${C.mute};letter-spacing:.06em;margin-top:8px;">MORNING BRIEFING · ${summary}</div>
      </td></tr>

      <!-- body -->
      <tr><td style="padding:18px 2px 0 2px;">${body}</td></tr>

      <!-- footer -->
      <tr><td style="padding:20px 2px 0 2px;border-top:1px solid ${C.line};">
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${C.mute};letter-spacing:.05em;">
          LIVE FREE · CEDAR POINT · ALTERED LIFE — swept ${esc(todayLabel)}, ${esc(String(localHour).padStart(2, "0"))}:00 ${esc(tz.split("/")[1] || tz)}
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const subject = rows.length === 0
    ? `Watchman: wall's quiet — ${todayLabel}`
    : `Watchman: ${rows.length} due${overdue ? ` (${overdue} over)` : ""} — ${todayLabel}`;

  return { subject, html };
}

// ── Send ────────────────────────────────────────────────────
async function send({ subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: DIGEST_FROM, to: [DIGEST_TO], subject, html }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) die(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
  console.log(`✓ Digest sent to ${DIGEST_TO} — ${subject}`);
}

// ── Run ─────────────────────────────────────────────────────
(async () => {
  const rows = await fetchDue();
  console.log(`Read ${rows.length} due item(s) from v_due_now.`);
  const email = buildEmail(rows);
  await send(email);
})().catch((e) => die(e?.message || String(e)));
