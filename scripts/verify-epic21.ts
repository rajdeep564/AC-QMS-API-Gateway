/**
 * Epic 21 — SOP export integration verification.
 *
 * Checks: contract doc, sop-client health+generate, standing/batch render,
 * non-blocking failure (#6), downloads, session 1–3 regression.
 * Fidelity (#5) is manual — reported as a note with COA file path.
 */

import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  DocType,
  FileType,
  RenderStatus,
  Role,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { JwtAccessPayload } from "../src/types/auth.types";
import { health, generate } from "../src/services/sop-client";
import type { ProductConfigDto } from "../src/services/sop-client";
import { executeDocumentRender } from "../src/services/render-documents.service";
import { AuditAction } from "../src/services/audit.service";
import {
  DEV_PASSWORD,
  cleanupVerifierHarnessData,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";
import {
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import {
  checkAwsSection,
  completeAwsSection,
} from "../src/modules/aws/aws-compliance.service";
import { patchAwsSection } from "../src/modules/aws/aws.service";
import {
  signAndIssueCoa,
  transitionDocument,
} from "../src/modules/documents/documents.service";
import { listBatchDocuments } from "../src/modules/documents/attachments.service";

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

async function getUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  if (!user) throw new Error(`User ${username} not found`);
  return user;
}

function passingReadings(test: {
  resultType: string;
  operator: string | null;
  minValue: { toString(): string } | null;
  maxValue: { toString(): string } | null;
}): Record<string, unknown> {
  if (test.resultType === "QUALITATIVE") return { passFail: "PASS" };
  const min = test.minValue ? Number(test.minValue.toString()) : null;
  const max = test.maxValue ? Number(test.maxValue.toString()) : null;
  if (test.operator === "BETWEEN" && min != null && max != null) {
    return { variables: { result: (min + max) / 2 } };
  }
  if (test.operator === "NMT" && max != null) {
    return { variables: { result: max * 0.5 } };
  }
  if (test.operator === "NLT" && min != null) {
    return { variables: { result: min * 1.01 } };
  }
  return { variables: { result: 1 } };
}

async function completeAwsSectionPair(
  sectionId: string,
  readings: Record<string, unknown>,
  analystId: string,
  checkerId: string,
) {
  await patchAwsSection(
    sectionId,
    { readings },
    { readings },
    actor(analystId, Role.QC_EXEC),
  );
  await completeAwsSection(sectionId, actor(analystId, Role.QC_EXEC));
  await checkAwsSection(
    sectionId,
    { password: DEV_PASSWORD },
    actor(checkerId, Role.QC_EXEC),
  );
}

function runVerifyScript(script: string): string | null {
  try {
    execSync(`npm run ${script}`, {
      cwd: join(__dirname, ".."),
      stdio: "pipe",
      encoding: "utf8",
    });
    return null;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return output
      ? `${script} failed:\n${output.slice(-2000)}`
      : `${script} failed`;
  }
}

async function waitForSpecRenderIdle(specId: string, maxMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const spec = await prisma.spec.findUnique({
      where: { id: specId },
      select: { renderStatus: true },
    });
    if (spec?.renderStatus !== RenderStatus.PENDING) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for spec ${specId} render to leave PENDING`);
}

async function main() {
  const failures: string[] = [];
  const notes: string[] = [];

  // #1 SOP_CONTRACT.md
  const contractPath = join(__dirname, "../SOP_CONTRACT.md");
  if (!existsSync(contractPath)) {
    failures.push("#1 SOP_CONTRACT.md missing");
  } else {
    const text = readFileSync(contractPath, "utf8");
    if (!text.includes("POST /generate") || !text.includes("POST /convert/pdf")) {
      failures.push("#1 SOP_CONTRACT.md missing expected endpoints");
    } else {
      console.log("#1 SOP_CONTRACT.md OK");
    }
  }

  // #2 sop-client
  try {
    const h = await health();
    if (h.status !== "ok") throw new Error(JSON.stringify(h));
    const glycinePath = join(
      __dirname,
      "../../AC-QMS-DOC-Module/config/products/glycine_ip.json",
    );
    const product = JSON.parse(readFileSync(glycinePath, "utf8")) as ProductConfigDto;
    const buf = await generate({
      document_type: "specification",
      product,
      revision_no: "01",
    });
    if (buf.byteLength < 1000 || buf[0] !== 0x50) {
      throw new Error(`invalid DOCX (${buf.byteLength} bytes)`);
    }
    console.log(`#2 sop-client OK (${buf.byteLength} bytes)`);
  } catch (err) {
    failures.push(`#2 sop-client: ${err instanceof Error ? err.message : err}`);
  }

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const product = await ensureVerifierProduct();
  await cleanupVerifierHarnessData(product.id);
  await ensureVerifierActiveMaster(kavya.id);
  const signedSpec = await ensureQaSignedHarnessSpec(
    product.id,
    kavya.id,
    priya.id,
    sanjay.id,
  );

  // #3 standing render — wait for QA-sign scheduled render, then ensure 2×DOCX + 2×PDF
  try {
    await waitForSpecRenderIdle(signedSpec.id);

    let attachments = await prisma.fileAttachment.findMany({
      where: { specId: signedSpec.id },
    });
    if (attachments.length < 4) {
      const result = await executeDocumentRender({
        kind: "STANDING_SPEC",
        specId: signedSpec.id,
        actorId: kavya.id,
      });
      if (result.status !== "rendered") {
        failures.push(`#3 standing render status=${result.status}`);
      }
      attachments = await prisma.fileAttachment.findMany({
        where: { specId: signedSpec.id },
      });
    }

    const docxCount = attachments.filter((a) => a.fileType === FileType.DOCX).length;
    const pdfCount = attachments.filter((a) => a.fileType === FileType.PDF).length;
    if (docxCount !== 2) {
      failures.push(`#3 expected 2 DOCX (SPEC+MOA), got ${docxCount}`);
    } else if (pdfCount !== 2) {
      failures.push(`#3 expected 2 PDF (SPEC+MOA), got ${pdfCount} — check LibreOffice / LIBREOFFICE_PATH`);
    } else {
      console.log(`#3 standing render OK (docx=${docxCount}, pdf=${pdfCount})`);
    }

    const spec = await prisma.spec.findUnique({ where: { id: signedSpec.id } });
    if (spec?.renderStatus !== RenderStatus.RENDERED) {
      failures.push(`#3 renderStatus=${spec?.renderStatus}`);
    }
  } catch (err) {
    failures.push(`#3 standing: ${err instanceof Error ? err.message : err}`);
  }

  // #4 batch AWS + COA
  let batchId: string | null = null;
  let awsDocId: string | null = null;
  let coaDocId: string | null = null;
  try {
    const created = await createBatch(
      product.id,
      {
        batchNo: `E21-${Date.now().toString(36).toUpperCase()}`,
        sourceSpecId: signedSpec.id,
        assignedQcExecId: kavya.id,
        batchSize: "100 kg",
      },
      actor(priya.id, Role.QC_MGR),
    );
    batchId = created.batch.id;
    await submitBatch(created.batch.id, actor(priya.id, Role.QC_MGR));
    await approveBatch(created.batch.id, DEV_PASSWORD, actor(sanjay.id, Role.QA_MGR));

    const docs = await prisma.batchDocument.findMany({ where: { batchId: created.batch.id } });
    const aws = docs.find((d) => d.docType === DocType.AWS);
    if (!aws) throw new Error("AWS missing after batch approve");
    awsDocId = aws.id;

    const sections = await prisma.awsSection.findMany({
      where: { batchDocumentId: aws.id },
      include: { specDocumentTest: true },
    });
    for (const section of sections) {
      await completeAwsSectionPair(
        section.id,
        passingReadings(section.specDocumentTest),
        kavya.id,
        meera.id,
      );
    }

    await transitionDocument(aws.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC), DEV_PASSWORD);
    await transitionDocument(aws.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);
    await transitionDocument(aws.id, "SIGN", actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

    // Wait briefly for fire-and-forget, then force await
    await executeDocumentRender({ kind: "AWS", batchDocumentId: aws.id, actorId: sanjay.id });

    const coa = await prisma.batchDocument.findFirst({
      where: { batchId: created.batch.id, docType: DocType.COA },
    });
    if (!coa) throw new Error("COA missing after AWS sign");
    coaDocId = coa.id;

    await signAndIssueCoa(coa.id, actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);
    await executeDocumentRender({ kind: "COA", batchDocumentId: coa.id, actorId: sanjay.id });

    const awsAtt = await prisma.fileAttachment.findMany({ where: { batchDocumentId: aws.id } });
    const coaAtt = await prisma.fileAttachment.findMany({ where: { batchDocumentId: coa.id } });
    if (awsAtt.filter((a) => a.fileType === FileType.DOCX).length !== 1 ||
        awsAtt.filter((a) => a.fileType === FileType.PDF).length !== 1) {
      failures.push(`#4 AWS attachments expected 1 DOCX + 1 PDF, got ${awsAtt.length}`);
    } else if (
      coaAtt.filter((a) => a.fileType === FileType.DOCX).length !== 1 ||
      coaAtt.filter((a) => a.fileType === FileType.PDF).length !== 1
    ) {
      failures.push(`#4 COA attachments expected 1 DOCX + 1 PDF, got ${coaAtt.length}`);
    } else {
      console.log(`#4 batch flow OK (aws + coa docx/pdf each)`);
    }

    const coaPdf = coaAtt.find((a) => a.fileType === FileType.PDF);
    if (coaPdf) {
      notes.push(
        `#5 fidelity (manual): open storage/${coaPdf.filePath} vs Aditya Glycine COA reference`,
      );
    }
  } catch (err) {
    failures.push(`#4 batch: ${err instanceof Error ? err.message : err}`);
  }

  // #6 non-blocking render failure
  try {
    if (!awsDocId) throw new Error("no awsDocId");
    // Simulate DOC-Module down by pointing at a dead port temporarily
    const prevUrl = process.env.DOC_MODULE_URL;
    process.env.DOC_MODULE_URL = "http://127.0.0.1:9";
    // Re-import won't pick env — execute with failing client by calling convert on wrong base via marking failed
    await prisma.batchDocument.update({
      where: { id: awsDocId },
      data: { renderStatus: RenderStatus.PENDING, renderError: null },
    });
    // Use a direct fail path: temporarily stop by executing against unreachable — need fresh config.
    // Instead: force call executeDocumentRender after stubbing is hard; mark FAILED via orchestrator error
    // by deleting required master product_code then restoring.
    const master = await prisma.productMaster.findFirst({
      where: { productId: product.id, status: "ACTIVE" },
      include: { fields: true },
    });
    const codeField = master?.fields.find((f) => f.fieldKey === "product_code");
    if (!codeField) throw new Error("product_code field missing");
    const saved = codeField.value;
    await prisma.productMasterField.update({
      where: { id: codeField.id },
      data: { value: "" },
    });
    const failResult = await executeDocumentRender({
      kind: "AWS",
      batchDocumentId: awsDocId,
      actorId: sanjay.id,
    });
    await prisma.productMasterField.update({
      where: { id: codeField.id },
      data: { value: saved },
    });
    if (prevUrl) process.env.DOC_MODULE_URL = prevUrl;

    const awsAfter = await prisma.batchDocument.findUnique({ where: { id: awsDocId } });
    if (failResult.status !== "render_failed" || awsAfter?.renderStatus !== RenderStatus.FAILED) {
      failures.push(
        `#6 expected FAILED render, got result=${failResult.status} status=${awsAfter?.renderStatus}`,
      );
    } else {
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: awsDocId, action: AuditAction.RENDER_FAILED },
        orderBy: { createdAt: "desc" },
      });
      if (!audit) {
        failures.push("#6 RENDER_FAILED audit missing");
      } else {
        console.log("#6 non-blocking failure OK (FAILED + audit)");
      }
    }

    // Retry after restore
    const retry = await executeDocumentRender({
      kind: "AWS",
      batchDocumentId: awsDocId,
      actorId: sanjay.id,
    });
    if (retry.status !== "rendered") {
      failures.push(`#6 retry after fix failed: ${retry.status}`);
    } else {
      console.log("#6 retry OK");
    }
  } catch (err) {
    failures.push(`#6: ${err instanceof Error ? err.message : err}`);
  }

  // #7 downloads list
  try {
    if (!batchId) throw new Error("no batchId");
    const listed = await listBatchDocuments(batchId, actor(kavya.id, Role.QC_EXEC));
    if (listed.documents.length < 1) {
      failures.push("#7 batch documents list empty");
    } else {
      console.log(`#7 batch documents list OK (${listed.documents.length} items)`);
    }

    // MKT on unreleased — create DRAFT batch should 404
    const draft = await createBatch(
      product.id,
      {
        batchNo: `E21D-${Date.now().toString(36).toUpperCase()}`,
        sourceSpecId: signedSpec.id,
        assignedQcExecId: kavya.id,
      },
      actor(priya.id, Role.QC_MGR),
    );
    try {
      await listBatchDocuments(draft.batch.id, actor(kavya.id, Role.MKT_EXEC));
      failures.push("#7 MKT on unreleased should 404");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found/i.test(msg)) {
        failures.push(`#7 MKT expected not found, got ${msg}`);
      } else {
        console.log("#7 MKT unreleased → 404 OK");
      }
    }
  } catch (err) {
    failures.push(`#7: ${err instanceof Error ? err.message : err}`);
  }

  // #8 regression
  for (const script of ["verify:session1", "verify:session2", "verify:session3"] as const) {
    const err = runVerifyScript(script);
    if (err) failures.push(`#8 ${err}`);
    else console.log(`#8 ${script} OK`);
  }

  for (const n of notes) console.log(`NOTE ${n}`);

  if (failures.length === 0) {
    console.log("verify:epic21 — ALL CHECKS PASSED");
    process.exit(0);
  }
  console.error("verify:epic21 — FAILURES:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
