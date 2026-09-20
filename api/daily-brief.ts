import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDailyBrief } from "../lib/run";

// Vercel Cron cannot express a fixed local time across DST, so vercel.json
// schedules this twice a day (12:00 and 13:00 UTC) and runDailyBrief()
// itself decides — based on the current hour in America/Chicago — whether
// this is the invocation that should actually send the email.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const isVercelCron = req.headers.authorization === `Bearer ${cronSecret}`;
    const isManualTrigger = req.query.secret === cronSecret;
    if (!isVercelCron && !isManualTrigger) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const force = req.query.force === "true";

  // ?date=YYYY-MM-DD runs the brief against another day, so the send path can
  // be exercised from production on a day that would otherwise be skipped as
  // empty. Anchored at noon UTC to land on the intended local day under DST.
  let now: Date | undefined;
  const dateParam = req.query.date;
  if (typeof dateParam === "string" && dateParam.length > 0) {
    now = new Date(`${dateParam}T12:00:00Z`);
    if (Number.isNaN(now.getTime())) {
      res.status(400).json({ error: `Invalid date: ${dateParam} (expected YYYY-MM-DD)` });
      return;
    }
  }

  try {
    const result = await runDailyBrief({ force, now });
    res.status(200).json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Unknown error" });
  }
}
