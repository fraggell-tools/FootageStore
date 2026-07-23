import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, imports, type ImportSelection } from "@/lib/db/schema";
import { getClipQueue } from "@/lib/queue";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { clientId, sourceFolderId, sourceFolderName, selection } = body as {
    clientId?: string;
    sourceFolderId?: string;
    sourceFolderName?: string;
    selection?: ImportSelection;
  };

  if (!clientId || !sourceFolderId || !sourceFolderName) {
    return NextResponse.json(
      { error: "clientId, sourceFolderId and sourceFolderName are required" },
      { status: 400 }
    );
  }
  const hasFolders = Array.isArray(selection?.folders) && selection.folders.length > 0;
  const hasFiles = Array.isArray(selection?.files) && selection.files.length > 0;
  if (!hasFolders && !hasFiles) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.driveFolderId) {
    return NextResponse.json(
      { error: "Client has no Drive folder — re-create it or run a sync first" },
      { status: 400 }
    );
  }

  const [row] = await db
    .insert(imports)
    .values({
      clientId,
      sourceFolderId,
      sourceFolderName,
      selection: { folders: selection!.folders ?? [], files: selection!.files ?? [] },
      createdBy: session.user.id ?? null,
    })
    .returning({ id: imports.id });

  await getClipQueue().add("import-drive", { importId: row.id }, { jobId: row.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
