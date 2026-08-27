import ical, { VEvent } from "node-ical";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const TIMEZONE = "America/Chicago";

export interface BriefEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  attendees: string[];
}

function normalizeAttendees(raw: VEvent["attendee"]): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((a) => {
      if (typeof a === "string") return stripMailto(a);
      const params = (a as any).params ?? {};
      const name: string | undefined = params.CN;
      const val: string | undefined = (a as any).val;
      const email = val ? stripMailto(val) : undefined;
      if (name && email && name !== email) return `${name} <${email}>`;
      return name ?? email ?? "";
    })
    .filter(Boolean);
}

function stripMailto(v: string): string {
  return v.replace(/^mailto:/i, "");
}

// Local calendar-day boundaries in `tz`, expressed as real Date instants.
export function dayBounds(reference: Date, tz: string): { start: Date; end: Date } {
  const local = toZonedTime(reference, tz);
  const y = local.getFullYear();
  const m = local.getMonth();
  const d = local.getDate();
  const start = fromZonedTime(new Date(y, m, d, 0, 0, 0), tz);
  const end = fromZonedTime(new Date(y, m, d + 1, 0, 0, 0), tz);
  return { start, end };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

async function fetchEvents(icsSource: string): Promise<Record<string, VEvent>> {
  const isUrl = /^https?:\/\//i.test(icsSource);
  const data = isUrl ? await ical.async.fromURL(icsSource) : await ical.async.parseFile(icsSource);
  const events: Record<string, VEvent> = {};
  for (const [key, value] of Object.entries(data)) {
    if ((value as any).type === "VEVENT") events[key] = value as VEvent;
  }
  return events;
}

/**
 * Returns every occurrence (including expanded recurrences) that overlaps
 * `reference`'s calendar day in `TIMEZONE`.
 */
export async function getEventsForDay(icsSource: string, reference: Date): Promise<BriefEvent[]> {
  const events = await fetchEvents(icsSource);
  const { start: dayStart, end: dayEnd } = dayBounds(reference, TIMEZONE);
  const results: BriefEvent[] = [];

  for (const event of Object.values(events)) {
    const allDay = (event as any).datetype === "date";
    const duration = event.end.getTime() - event.start.getTime();

    if (event.rrule) {
      // node-ical/rrule return occurrences as "floating" Dates: the UTC
      // getters hold the wall-clock time in the event's TZID, not a real
      // instant. Re-anchor each occurrence to its TZID to get the true UTC
      // instant before comparing against anything real (day bounds, exdate,
      // recurrence-id overrides — all of which node-ical resolves to real
      // instants already).
      const tzid: string | undefined = (event.rrule as any).origOptions?.tzid;
      const toRealInstant = (floating: Date): Date =>
        tzid
          ? fromZonedTime(
              new Date(
                floating.getUTCFullYear(),
                floating.getUTCMonth(),
                floating.getUTCDate(),
                floating.getUTCHours(),
                floating.getUTCMinutes(),
                floating.getUTCSeconds()
              ),
              tzid
            )
          : floating;

      // Expand recurrence occurrences that could land in today's window,
      // padding by one duration on each side for events crossing midnight.
      // The padding window is itself converted to "floating" terms since
      // rrule.between expects/returns floating instants when tzid is set.
      const toFloating = (real: Date): Date => {
        if (!tzid) return real;
        const zoned = toZonedTime(real, tzid);
        return new Date(
          Date.UTC(
            zoned.getFullYear(),
            zoned.getMonth(),
            zoned.getDate(),
            zoned.getHours(),
            zoned.getMinutes(),
            zoned.getSeconds()
          )
        );
      };

      const occurrences = event.rrule.between(
        toFloating(new Date(dayStart.getTime() - duration)),
        toFloating(new Date(dayEnd.getTime() + duration)),
        true
      );

      const exceptions = Object.values(event.exdate ?? {}).map((d) => (d as Date).getTime());

      for (const floatingStart of occurrences) {
        const realStart = toRealInstant(floatingStart);
        if (exceptions.some((ex) => Math.abs(ex - realStart.getTime()) < 1000)) continue;

        // A recurrence override (moved/edited single instance) replaces the
        // computed occurrence for that recurrence-id.
        const override = Object.values(event.recurrences ?? {}).find(
          (r) => Math.abs((r as any).recurrenceid.getTime() - realStart.getTime()) < 1000
        ) as VEvent | undefined;

        const effectiveStart = override ? override.start : realStart;
        const effectiveEnd = override ? override.end : new Date(realStart.getTime() + duration);

        if (overlaps(effectiveStart, effectiveEnd, dayStart, dayEnd)) {
          results.push({
            title: (override ?? event).summary ?? "(untitled)",
            start: effectiveStart,
            end: effectiveEnd,
            allDay,
            location: (override ?? event).location ?? null,
            attendees: normalizeAttendees((override ?? event).attendee),
          });
        }
      }
    } else if (overlaps(event.start, event.end, dayStart, dayEnd)) {
      results.push({
        title: event.summary ?? "(untitled)",
        start: event.start,
        end: event.end,
        allDay,
        location: event.location ?? null,
        attendees: normalizeAttendees(event.attendee),
      });
    }
  }

  results.sort((a, b) => a.start.getTime() - b.start.getTime());
  return results;
}
