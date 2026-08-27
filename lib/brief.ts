import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { BriefEvent, TIMEZONE } from "./ics";

// Free-time gaps are only surfaced within this local window each day.
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 18;

function fmtTime(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "h:mm a");
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

export function buildBrief(events: BriefEvent[], reference: Date): { subject: string; text: string; html: string } {
  const heading = fmtDateHeading(reference);
  const subject = events.length === 0 ? `Daily Brief — ${heading} — no events` : `Daily Brief — ${heading}`;

  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const gaps = computeGaps(timed, reference);

  const textLines: string[] = [`Daily Brief — ${heading}`, ""];
  const htmlParts: string[] = [
    `<h2 style="margin:0 0 4px;font-family:sans-serif;">Daily Brief</h2>`,
    `<p style="margin:0 0 16px;color:#555;font-family:sans-serif;">${heading}</p>`,
  ];

  if (events.length === 0) {
    textLines.push("No events on your calendar today.");
    htmlParts.push(`<p style="font-family:sans-serif;">No events on your calendar today.</p>`);
  } else {
    if (allDay.length > 0) {
      textLines.push("All day:");
      htmlParts.push(`<p style="font-family:sans-serif;"><strong>All day</strong></p><ul style="font-family:sans-serif;">`);
      for (const e of allDay) {
        textLines.push(`  • ${e.title}`);
        htmlParts.push(`<li>${escapeHtml(e.title)}</li>`);
      }
      htmlParts.push(`</ul>`);
      textLines.push("");
    }

    textLines.push("Agenda:");
    htmlParts.push(`<p style="font-family:sans-serif;"><strong>Agenda</strong></p><ul style="font-family:sans-serif;padding-left:20px;">`);
    for (const e of timed) {
      const time = `${fmtTime(e.start)} – ${fmtTime(e.end)}`;
      textLines.push(`  • ${time}  ${e.title}`);
      if (e.location) textLines.push(`      Location: ${e.location}`);
      if (e.attendees.length > 0) textLines.push(`      Attendees: ${e.attendees.join(", ")}`);

      htmlParts.push(
        `<li style="margin-bottom:10px;"><strong>${time}</strong> — ${escapeHtml(e.title)}` +
          (e.location ? `<br/><span style="color:#555;">📍 ${escapeHtml(e.location)}</span>` : "") +
          (e.attendees.length > 0
            ? `<br/><span style="color:#555;">👥 ${escapeHtml(e.attendees.join(", "))}</span>`
            : "") +
          `</li>`
      );
    }
    htmlParts.push(`</ul>`);

    if (gaps.length > 0) {
      textLines.push("", "Free time:");
      htmlParts.push(`<p style="font-family:sans-serif;"><strong>Free time</strong></p><ul style="font-family:sans-serif;padding-left:20px;">`);
      for (const g of gaps) {
        const dur = fmtDuration(g.end.getTime() - g.start.getTime());
        textLines.push(`  • ${fmtTime(g.start)} – ${fmtTime(g.end)} (${dur})`);
        htmlParts.push(`<li>${fmtTime(g.start)} – ${fmtTime(g.end)} <span style="color:#888;">(${dur})</span></li>`);
      }
      htmlParts.push(`</ul>`);
    }
  }

  return {
    subject,
    text: textLines.join("\n"),
    html: `<div>${htmlParts.join("\n")}</div>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
