import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_NICK_USER_ID = process.env.SLACK_NICK_USER_ID || "U1QAY45TP";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { description, screenshot, panelState, logTail, reportedBy } = body;

    const reportsDir = join(process.env.DATA_DIR || "/data", "bug-reports");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const reportId = `report-${ts}`;
    const reportDir = join(reportsDir, reportId);
    mkdirSync(reportDir, { recursive: true });

    const report = {
      id: reportId,
      reportedAt: new Date().toISOString(),
      reportedBy: reportedBy || session.user?.email || "unknown",
      description, panelState, logTail,
    };
    writeFileSync(join(reportDir, "report.json"), JSON.stringify(report, null, 2));

    let screenshotSaved = false;
    if (screenshot) {
      const imgBuffer = Buffer.from(screenshot.replace(/^data:image\/\w+;base64,/, ""), "base64");
      writeFileSync(join(reportDir, "screenshot.png"), imgBuffer);
      screenshotSaved = true;
    }

    if (SLACK_BOT_TOKEN) {
      await sendSlackBugReport({ reportId, reportedBy: report.reportedBy, description, panelState, logTail, screenshotBase64: screenshotSaved ? screenshot : null });
    }

    return NextResponse.json({ success: true, reportId });
  } catch (e) {
    console.error("Bug report failed:", e);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}

async function sendSlackBugReport({ reportId, reportedBy, description, panelState, logTail, screenshotBase64 }: any) {
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ users: SLACK_NICK_USER_ID }),
  });
  const openData = await openRes.json();
  if (!openData.ok) { console.error("Slack open DM failed:", openData.error); return; }
  const channelId = openData.channel.id;

  const state = panelState || {};
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🐛 Panel Bug Report" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From:*\n${reportedBy}` },
        { type: "mrkdwn", text: `*Version:*\nv${state.version || "unknown"}` },
        { type: "mrkdwn", text: `*Platform:*\n${state.platform === true ? "Mac" : "Windows"}` },
        { type: "mrkdwn", text: `*Client:*\n${state.activeClient?.name || "none"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${description || "_No description provided_"}` } },
  ];

  if (state.searchQuery || state.filterShotType || state.filterTags?.length || state.filterSkus?.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Active filters:*\nSearch: \`${state.searchQuery || "none"}\` | Shot type: \`${state.filterShotType || "none"}\` | Tags: \`${(state.filterTags || []).join(", ") || "none"}\` | SKUs: \`${(state.filterSkus || []).join(", ") || "none"}\`` },
    });
  }

  if (logTail?.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Last log lines:*\n\`\`\`${logTail.slice(-8).join("\n")}\`\`\`` } });
  }

  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Report ID: \`${reportId}\`` }] });

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelId, blocks, text: `Bug report from ${reportedBy}` }),
  });

  if (screenshotBase64) {
    const imgBuffer = Buffer.from(screenshotBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const formData = new FormData();
    formData.append("channels", channelId);
    formData.append("filename", "screenshot.png");
    formData.append("initial_comment", "Panel screenshot at time of report");
    formData.append("file", new Blob([imgBuffer], { type: "image/png" }), "screenshot.png");
    await fetch("https://slack.com/api/files.upload", {
      method: "POST",
      headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
      body: formData,
    });
  }
}
