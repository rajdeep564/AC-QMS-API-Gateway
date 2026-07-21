/**
 * Shared AWS section patching for verifiers — aligned with SAMPLE_SPEC_BODY.
 */
import { Role } from "@prisma/client";
import {
  acknowledgeExpiredSection,
  acknowledgeOosSection,
  checkAwsSection,
  completeAwsSection,
} from "../../src/modules/aws/aws-compliance.service";
import { patchAwsSection } from "../../src/modules/aws/aws.service";
import { prisma } from "../../src/lib/prisma-types";
import { JwtAccessPayload } from "../../src/types/auth.types";
import { DEV_PASSWORD } from "./verifier-harness";

export { SAMPLE_SPEC_BODY, EXPECTED_TEST_COUNT } from "../fixtures/spec-sample-body";

const IN_SPEC_BY_TEST: Record<string, number> = {
  pH: 6.1,
  Chlorides: 50,
  "Loss on drying": 0.2,
  Assay: 99.5,
};

/** Assay value below SAMPLE_SPEC_BODY min (98.5) for intentional OOS. */
export const ASSAY_OOS_RESULT = 95.0;

export const OOS_ACK_COMMENT =
  "OOS acknowledged with substantive comment for AWS render verification";

export const EXPIRY_ACK_COMMENT = "Valid ten+ chars for expiry ack";

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

export async function patchSectionInSpec(
  section: { id: string; testName: string },
  analystId: string,
): Promise<void> {
  if (section.testName === "Description") {
    await patchAwsSection(
      section.id,
      { readings: { passFail: "PASS" } },
      { readings: { passFail: "PASS" } },
      actor(analystId, Role.QC_EXEC),
    );
    return;
  }

  const result = IN_SPEC_BY_TEST[section.testName];
  if (result === undefined) {
    throw new Error(`No in-spec reading configured for ${section.testName}`);
  }

  await patchAwsSection(
    section.id,
    { readings: { variables: { result } } },
    { readings: { variables: { result } } },
    actor(analystId, Role.QC_EXEC),
  );
}

/** Intentional Assay OOS + acknowledge (for mapper / B-2.3 #4). */
export async function patchAssayOosAndAck(sectionId: string, analystId: string): Promise<void> {
  await patchAwsSection(
    sectionId,
    { readings: { variables: { result: ASSAY_OOS_RESULT } } },
    { readings: { variables: { result: ASSAY_OOS_RESULT } } },
    actor(analystId, Role.QC_EXEC),
  );
  const row = await prisma.awsSection.findUniqueOrThrow({ where: { id: sectionId } });
  if (!row.isOos) {
    throw new Error("Assay must be OOS after patching below min");
  }
  await acknowledgeOosSection(
    sectionId,
    { comment: OOS_ACK_COMMENT },
    actor(analystId, Role.QC_EXEC),
  );
}

/**
 * Attach expired instrument + acknowledge on a qualitative section (Description).
 * Returns instrument id for cleanup.
 */
export async function attachExpiredInstrumentAndAck(
  sectionId: string,
  analystId: string,
): Promise<string> {
  const instrument = await prisma.instrument.create({
    data: {
      instrumentId: `EXP-${Date.now()}`,
      name: "Expired verifier instrument",
      useBefore: new Date("2020-01-01"),
    },
  });

  await patchAwsSection(
    sectionId,
    { instrumentId: instrument.id, readings: { passFail: "PASS" } },
    { instrumentId: instrument.id, readings: { passFail: "PASS" } },
    actor(analystId, Role.QC_EXEC),
  );

  await acknowledgeExpiredSection(
    sectionId,
    { type: "instrument", comment: EXPIRY_ACK_COMMENT },
    actor(analystId, Role.QC_EXEC),
  );

  return instrument.id;
}

export async function completeSectionTwoPerson(
  sectionId: string,
  analystId: string,
  checkerId: string,
): Promise<void> {
  await completeAwsSection(sectionId, actor(analystId, Role.QC_EXEC));
  await checkAwsSection(sectionId, { password: DEV_PASSWORD }, actor(checkerId, Role.QC_EXEC));
}

/**
 * Fill all AWS sections in-spec (or Assay OOS + Description expiry when options set),
 * then complete two-person for each.
 */
export async function fillAndCompleteAllSections(input: {
  sections: { id: string; testName: string }[];
  analystId: string;
  checkerId: string;
  assayOos?: boolean;
  descriptionExpiryAck?: boolean;
}): Promise<{ instrumentId: string | null }> {
  let instrumentId: string | null = null;

  for (const section of input.sections) {
    if (section.testName === "Assay" && input.assayOos) {
      await patchAssayOosAndAck(section.id, input.analystId);
    } else if (section.testName === "Description" && input.descriptionExpiryAck) {
      instrumentId = await attachExpiredInstrumentAndAck(section.id, input.analystId);
    } else {
      await patchSectionInSpec(section, input.analystId);
    }
    await completeSectionTwoPerson(section.id, input.analystId, input.checkerId);
  }

  return { instrumentId };
}
