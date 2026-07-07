/**
 * Backfill clips.month + clips.angle by cross-referencing the ORIGINAL
 * "Fraggell Editors" shared drive, which still has the proper
 * Client > M{n} > Angle N - Name > … structure. The current "Fraggell Footage
 * Store" drive is a flattened overflow copy, so the folder structure was lost
 * there — but the filenames still match.
 *
 * For each Footage Store client we walk the matching Editors client folder,
 * build a normalized-filename -> {month, angle} map, then fill in each clip whose
 * month/angle is still blank. A filename-pattern fallback (…_M1_A3_…) covers
 * clips that don't match by name. Only fills blanks — never overwrites a manual
 * edit. Re-runnable.
 *
 * Run with:  docker exec app-worker-1 npx tsx worker/backfillLabels.ts
 */
import { Pool } from "pg";
import { google } from "googleapis";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getDrive() {
  const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: o });
}

const isVideo = (n: string) => /\.(mov|mp4|m4v|avi|mkv|mxf|mts|webm)$/i.test(n);
const looksLikeMonth = (s: string) =>
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t)?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i.test(s) ||
  /^\d{4}[-_ /]\d{1,2}$/.test(s) ||
  /^(m|month)\s?\d{1,2}$/i.test(s);
const normName = (n: string) => n.toLowerCase().replace(/^copy of /, "").trim();
const normClient = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const slice = (s: string | null, n: number) => (s == null ? null : s.slice(0, n));

// Parse "…_M1_A3_…" out of a filename as a fallback. Split on separators rather
// than using \b, because \b doesn't fire around underscores (_M1_ is all \w).
function fromFilename(name: string): { month: string; angle: string } | null {
  const tokens = name.split(/[_\s.\-]+/);
  const mTok = tokens.find((t) => /^m\d{1,2}$/i.test(t));
  const aTok = tokens.find((t) => /^a\d{1,2}$/i.test(t));
  if (!mTok) return null;
  return { month: "M" + mTok.slice(1), angle: aTok ? "Angle " + aTok.slice(1) : "" };
}

async function main() {
  const drive = getDrive();
  const drivesList = await drive.drives.list({ pageSize: 100, fields: "drives(id,name)" });
  const editors = (drivesList.data.drives || []).find((d) => /editor/i.test(d.name || ""));
  if (!editors?.id) {
    console.error("No 'Fraggell Editors' shared drive found. Aborting.");
    await pool.end();
    process.exit(1);
  }
  const driveId = editors.id;

  async function kids(id: string) {
    let out: { id: string; name: string; mimeType: string }[] = [];
    let token: string | undefined;
    do {
      const r = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType)",
        supportsAllDrives: true, includeItemsFromAllDrives: true,
        corpora: "drive", driveId, pageSize: 300, pageToken: token,
      });
      out = out.concat((r.data.files || []) as never[]);
      token = r.data.nextPageToken || undefined;
    } while (token);
    return out;
  }

  // Map Editors top-level client folders by normalized name.
  const editorClients = new Map<string, string>(); // normClient -> folderId
  for (const f of await kids(driveId)) {
    if (f.mimeType.includes("folder")) editorClients.set(normClient(f.name), f.id);
  }

  // Footage Store clients.
  const { rows: fsClients } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM clients ORDER BY name"
  );

  let totalUpdated = 0;
  for (const client of fsClients) {
    const folderId = editorClients.get(normClient(client.name));
    if (!folderId) { console.log(`- ${client.name}: no match in Editors, skipping`); continue; }

    // Walk the Editors client folder; build filename -> {month, angle}.
    const map = new Map<string, { month: string; angle: string | null }>();
    const stack: { id: string; segs: string[] }[] = [{ id: folderId, segs: [] }];
    let files = 0;
    while (stack.length) {
      const { id, segs } = stack.pop()!;
      for (const e of await kids(id)) {
        if (e.mimeType.includes("folder")) stack.push({ id: e.id, segs: [...segs, e.name] });
        else if (isVideo(e.name)) {
          files++;
          const idx = segs.findIndex(looksLikeMonth);
          if (idx === -1) continue;
          map.set(normName(e.name), { month: segs[idx], angle: segs[idx + 1] || null });
        }
      }
    }

    // Fill blank month/angle on this client's clips.
    const { rows: clips } = await pool.query<{ id: string; original_filename: string }>(
      "SELECT id, original_filename FROM clips WHERE client_id = $1 AND (month IS NULL OR angle IS NULL)",
      [client.id]
    );
    let matched = 0, viaName = 0;
    for (const clip of clips) {
      let hit = map.get(normName(clip.original_filename));
      let month: string | null, angle: string | null;
      if (hit) { month = hit.month; angle = hit.angle; matched++; }
      else {
        const fb = fromFilename(clip.original_filename);
        if (!fb) continue;
        month = fb.month; angle = fb.angle || null; viaName++;
      }
      await pool.query(
        "UPDATE clips SET month = COALESCE(month, $2), angle = COALESCE(angle, $3), updated_at = now() WHERE id = $1",
        [clip.id, slice(month, 50), slice(angle, 100)]
      );
      totalUpdated++;
    }
    console.log(`- ${client.name}: ${files} editor files, clips ${clips.length} → matched ${matched}, filename ${viaName}`);
  }

  console.log(`Done. Updated ${totalUpdated} clips.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
