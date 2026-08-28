import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { BriefEvent, TIMEZONE } from "./ics";

// Free-time gaps are only surfaced within this local window each day.
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 18;

function fmtTimeParts(d: Date): { hm: string; ampm: string } {
  return {
    hm: formatInTimeZone(d, TIMEZONE, "h:mm"),
    ampm: formatInTimeZone(d, TIMEZONE, "a"),
  };
}

function fmtTime(d: Date): string {
  const { hm, ampm } = fmtTimeParts(d);
  return `${hm} ${ampm}`;
}

function fmtDateHeading(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "EEEE, MMMM d, yyyy");
}

function windowBounds(reference: Date): { start: Date; end: Date } {
  const local = toZonedTime(reference, TIMEZONE);
  const y = local.getFullYear();
  const m = local.getMonth();
  const d = local.getDate();
  const start = fromZonedTime(new Date(y, m, d, WINDOW_START_HOUR, 0, 0), TIMEZONE);
  const end = fromZonedTime(new Date(y, m, d, WINDOW_END_HOUR, 0, 0), TIMEZONE);
  return { start, end };
}

interface Gap {
  start: Date;
  end: Date;
}

function computeGaps(timedEvents: BriefEvent[], reference: Date): Gap[] {
  if (timedEvents.length === 0) return [];
  const { start: windowStart, end: windowEnd } = windowBounds(reference);

  // Merge overlapping/adjacent busy intervals first.
  const sorted = [...timedEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
  const busy: Gap[] = [];
  for (const ev of sorted) {
    const s = ev.start < windowStart ? windowStart : ev.start;
    const e = ev.end > windowEnd ? windowEnd : ev.end;
    if (e <= windowStart || s >= windowEnd) continue;
    const last = busy[busy.length - 1];
    if (last && s <= last.end) {
      last.end = e > last.end ? e : last.end;
    } else {
      busy.push({ start: s, end: e });
    }
  }

  const gaps: Gap[] = [];
  let cursor = windowStart;
  for (const b of busy) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = b.end > cursor ? b.end : cursor;
  }
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });

  // Drop slivers under 15 minutes.
  return gaps.filter((g) => g.end.getTime() - g.start.getTime() >= 15 * 60 * 1000);
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Committed single-theme design (no light/dark toggle) — a deep navy
// ground, since peacock coloring reads richest against dark plumage.
// Literal hex values throughout: CSS custom properties aren't reliably
// supported across email clients.
const EMAIL_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0A1428;
    color: #E9EEFB;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { padding: 40px 20px; display: flex; justify-content: center; }
  .brief {
    width: 100%;
    max-width: 600px;
    background: #101F3D;
    border: 1px solid #22315A;
    border-radius: 10px;
    padding: 36px 40px 44px;
  }
  .brief-head { margin-bottom: 32px; }
  .eyebrow {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #35CCC0;
  }
  .date {
    margin: 0;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-size: 26px;
    font-weight: 400;
    color: #E9EEFB;
    text-wrap: balance;
  }
  .section { margin-top: 30px; }
  .section:first-of-type { margin-top: 0; }
  .section-label {
    margin: 0 0 14px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #8091BC;
  }
  .allday-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .allday-list li { position: relative; padding-left: 18px; font-size: 14.5px; line-height: 1.5; color: #E9EEFB; }
  .allday-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #E3B23C;
  }
  .timeline { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
  .event { display: flex; gap: 16px; padding: 14px 0; border-bottom: 1px solid #22315A; }
  .event:last-child { border-bottom: none; padding-bottom: 0; }
  .event:first-child { padding-top: 0; }
  .event-time {
    flex: 0 0 84px;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
    font-size: 13.5px;
    font-weight: 600;
    color: #35CCC0;
    line-height: 1.45;
  }
  .event-time .sep { display: block; color: #3D5686; font-weight: 400; }
  .event-time .ampm { font-size: 10.5px; font-weight: 600; margin-left: 1px; color: #5FA9A2; }
  .event-rail { flex: 0 0 auto; display: flex; justify-content: center; padding-top: 5px; }
  .event-rail .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #E3B23C;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .event-rail .dot-core { width: 6px; height: 6px; border-radius: 50%; background: #35CCC0; display: block; }
  .event-body { flex: 1 1 auto; min-width: 0; }
  .event-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #E9EEFB; line-height: 1.4; }
  .event-meta { margin: 0; font-size: 13px; color: #8091BC; line-height: 1.6; }
  .event-meta + .event-meta { margin-top: 1px; }
  .event-meta .meta-label { color: #566F9E; }
  .free-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .free-item { display: flex; align-items: baseline; gap: 10px; padding-left: 130px; font-size: 13.5px; color: #6C7FAC; }
  .free-item .free-range { margin-left: -130px; width: 114px; flex: 0 0 114px; font-variant-numeric: tabular-nums; color: #6C7FAC; }
  .free-item .free-dur { color: #4F6390; }
  .empty { margin: 0; font-size: 14px; color: #8091BC; }
  .footnote { margin: 34px 0 0; padding-top: 18px; border-top: 1px solid #22315A; font-size: 11.5px; color: #4F6390; }
`;

export function buildBrief(events: BriefEvent[], reference: Date): { subject: string; text: string; html: string } {
  const heading = fmtDateHeading(reference);
  const subject = events.length === 0 ? `Daily Brief — ${heading} — no events` : `Daily Brief — ${heading}`;

  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const gaps = computeGaps(timed, reference);

  const textLines: string[] = [`Daily Brief — ${heading}`, ""];
  const bodyParts: string[] = [
    `<div class="brief-head"><p class="eyebrow">Daily Brief</p><h1 class="date">${escapeHtml(heading)}</h1></div>`,
  ];

  if (events.length === 0) {
    textLines.push("No events on your calendar today.");
    bodyParts.push(`<div class="section"><p class="empty">No events on your calendar today.</p></div>`);
  } else {
    if (allDay.length > 0) {
      textLines.push("All day:");
      const items = allDay.map((e) => `<li>${escapeHtml(e.title)}</li>`).join("");
      bodyParts.push(
        `<div class="section"><h2 class="section-label">All day</h2><ul class="allday-list">${items}</ul></div>`
      );
      for (const e of allDay) textLines.push(`  • ${e.title}`);
      textLines.push("");
    }

    textLines.push("Agenda:");
    const eventItems = timed
      .map((e) => {
        const startParts = fmtTimeParts(e.start);
        const endParts = fmtTimeParts(e.end);
        const timeHtml =
          `${startParts.hm}<span class="ampm">${startParts.ampm}</span>` +
          `<span class="sep">–</span>` +
          `${endParts.hm}<span class="ampm">${endParts.ampm}</span>`;

        textLines.push(`  • ${fmtTime(e.start)} – ${fmtTime(e.end)}  ${e.title}`);
        if (e.location) textLines.push(`      Location: ${e.location}`);
        if (e.attendees.length > 0) textLines.push(`      Attendees: ${e.attendees.join(", ")}`);

        const metaLines = [
          e.location ? `<p class="event-meta"><span class="meta-label">Location</span> ${escapeHtml(e.location)}</p>` : "",
          e.attendees.length > 0
            ? `<p class="event-meta"><span class="meta-label">With</span> ${escapeHtml(e.attendees.join(", "))}</p>`
            : "",
        ].join("");

        return (
          `<li class="event">` +
          `<div class="event-time">${timeHtml}</div>` +
          `<div class="event-rail"><span class="dot"><span class="dot-core"></span></span></div>` +
          `<div class="event-body"><p class="event-title">${escapeHtml(e.title)}</p>${metaLines}</div>` +
          `</li>`
        );
      })
      .join("");
    bodyParts.push(`<div class="section"><h2 class="section-label">Agenda</h2><ol class="timeline">${eventItems}</ol></div>`);

    if (gaps.length > 0) {
      textLines.push("", "Free time:");
      const gapItems = gaps
        .map((g) => {
          const dur = fmtDuration(g.end.getTime() - g.start.getTime());
          textLines.push(`  • ${fmtTime(g.start)} – ${fmtTime(g.end)} (${dur})`);
          return (
            `<li class="free-item">` +
            `<span class="free-range">${fmtTime(g.start)} – ${fmtTime(g.end)}</span>` +
            `<span class="free-dur">${dur}</span>` +
            `</li>`
          );
        })
        .join("");
      bodyParts.push(`<div class="section"><h2 class="section-label">Free time</h2><ul class="free-list">${gapItems}</ul></div>`);
    }
  }

  bodyParts.push(`<p class="footnote">Sent automatically by Briefer</p>`);

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(subject)}</title>
<style>${EMAIL_CSS}</style>
</head>
<body>
<div class="wrap"><div class="brief">${bodyParts.join("\n")}</div></div>
</body>
</html>`;

  return { subject, text: textLines.join("\n"), html };
}
