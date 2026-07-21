/**
 * STEP 1 contract gate — sop-client health + glycine generate.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generate, health } from "../src/services/sop-client";
import type { ProductConfigDto } from "../src/services/sop-client";

async function main() {
  const h = await health();
  if (h.status !== "ok") {
    throw new Error(`health failed: ${JSON.stringify(h)}`);
  }
  console.log("health OK:", h);

  const glycinePath = join(
    __dirname,
    "../../AC-QMS-DOC-Module/config/products/glycine_ip.json",
  );
  const product = JSON.parse(readFileSync(glycinePath, "utf8")) as ProductConfigDto;

  const buf = await generate({
    document_type: "specification",
    product,
    revision_no: "01",
    department: "QUALITY ASSURANCE",
  });

  if (buf.byteLength < 1000) {
    throw new Error(`DOCX too small: ${buf.byteLength}`);
  }
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("DOCX missing PK zip signature");
  }

  const out = join(__dirname, "../storage/documents/_gate/sop-client-glycine.docx");
  const { mkdirSync } = await import("fs");
  mkdirSync(join(__dirname, "../storage/documents/_gate"), { recursive: true });
  writeFileSync(out, buf);
  console.log(`sop-client generate OK: ${buf.byteLength} bytes → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
