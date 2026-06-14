import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pdfConfig } from "../config/pdf";

const s3 = new S3Client({ region: pdfConfig.s3.region });

export async function uploadAndSign(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<{ url: string; expiresAt: string }> {
  await s3.send(
    new PutObjectCommand({
      Bucket: pdfConfig.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  const command = new GetObjectCommand({ Bucket: pdfConfig.s3.bucket, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: pdfConfig.s3.signedUrlTtlSeconds });
  const expiresAt = new Date(Date.now() + pdfConfig.s3.signedUrlTtlSeconds * 1000).toISOString();

  return { url, expiresAt };
}
