/**
 * Lightweight Slack alerter for worker-side ops alerts (e.g. a transcription outage).
 *
 * Mirrors the bot-token DM pattern in src/app/api/bug-reports/route.ts, but DMs the whole
 * team via SLACK_USER_IDS (comma-separated, like fraggell-monitor) and no-ops cleanly when
 * unconfigured so it can never break the pipeline.
 *
 * Env:
 *   SLACK_BOT_TOKEN   xoxb-... bot token (already used for bug reports)
 *   SLACK_USER_IDS    comma-separated Slack user IDs to DM (falls back to SLACK_NICK_USER_ID)
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

function recipients(): string[] {
  return (process.env.SLACK_USER_IDS || process.env.SLACK_NICK_USER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * DM an alert to each configured Slack user. Never throws — failures are logged only,
 * so an alerting problem can't take down whatever called it.
 */
export async function sendSlackAlert(title: string, lines: string[]): Promise<void> {
  const users = recipients();
  if (!SLACK_BOT_TOKEN || users.length === 0) {
    console.warn(
      "[slackAlert] skipped — SLACK_BOT_TOKEN or SLACK_USER_IDS not configured"
    );
    return;
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: title } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `FootageStore worker · ${new Date().toISOString()}` },
      ],
    },
  ];

  for (const user of users) {
    try {
      const openRes = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ users: user }),
      });
      const openData = (await openRes.json()) as {
        ok: boolean;
        error?: string;
        channel?: { id: string };
      };
      if (!openData.ok || !openData.channel) {
        console.error(`[slackAlert] conversations.open failed for ${user}:`, openData.error);
        continue;
      }
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: openData.channel.id, blocks, text: title }),
      });
    } catch (err) {
      console.error(`[slackAlert] failed for ${user}:`, (err as Error).message);
    }
  }
}
