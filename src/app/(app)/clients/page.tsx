import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import ClientsGrid, { type ClientRow } from "@/components/clients/ClientsGrid";

async function getClients(): Promise<ClientRow[]> {
  // Per client: clip count + a representative thumbnail clip (most recent ready
  // clip that has a thumbnail), used as the card's background image.
  const result = await db.execute(sql`
    SELECT cl.id,
           cl.name,
           cl.slug,
           cl.display_name AS "displayName",
           COUNT(cp.id)::int AS "clipCount",
           (
             SELECT c2.id FROM clips c2
             WHERE c2.client_id = cl.id
               AND c2.thumbnail_path IS NOT NULL
               AND c2.status = 'ready'
             ORDER BY c2.created_at DESC
             LIMIT 1
           ) AS "thumbnailClipId"
    FROM clients cl
    LEFT JOIN clips cp ON cp.client_id = cl.id
    GROUP BY cl.id
    ORDER BY cl.name
  `);
  return result.rows as unknown as ClientRow[];
}

export default async function ClientsPage() {
  const clientList = await getClients();
  return <ClientsGrid clients={clientList} />;
}
