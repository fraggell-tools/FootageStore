import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 client for footage proxies. R2 has zero egress fees, so serving
// 480p previews to (often overseas) editors from the edge costs only storage.
// Ported from fraggell-review; trimmed to the proxy upload/serve path.
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME || "footagestore-proxies";

export const r2Enabled = !!(accountId && accessKeyId && secretAccessKey);

console.log(
  `R2: enabled=${r2Enabled}, bucket=${bucket}, accountId=${accountId ? "set" : "missing"}`
);

const client = r2Enabled
  ? new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    })
  : null;

let bucketChecked = false;

async function ensureCors() {
  if (!client) return;
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      })
    );
  } catch (err) {
    console.error("R2: failed to set CORS:", err instanceof Error ? err.message : err);
  }
}

async function ensureBucket() {
  if (bucketChecked || !client) return;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: "__probe__" }));
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchBucket") {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
  await ensureCors();
  bucketChecked = true;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  if (!client) {
    console.log("R2 upload: skipped, client not initialized");
    return;
  }
  await ensureBucket();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
  console.log(`R2 upload: success key=${key} size=${body.length}`);
}

export async function getR2PresignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
  if (!client) return null;
  await ensureBucket();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function existsInR2(key: string): Promise<boolean> {
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFromR2(key: string): Promise<void> {
  if (!client) return;
  await ensureBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
