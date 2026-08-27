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

  try {
    const result = await runDailyBrief({ force });
    res.status(200).json(result);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Unknown error" });
  }
}
