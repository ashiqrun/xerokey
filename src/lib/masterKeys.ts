// File: src/lib/masterKeys.ts

/**
 * 13 FIXED MASTER KEYS CONFIGURATION
 *
 * 1 Grand Master Key: Opens all 12 lockers sequentially (one by one).
 * 12 Individual Master Keys: Each dedicated to opening its designated locker bay (L-01 to L-12).
 *
 * UIDs can be customized here or overridden dynamically via environment variables.
 * Formats supported: 7-byte (e.g. "04:A1:B2:C3:D4:E5:F6") or 4-byte (e.g. "A1:B2:C3:D4"),
 * with or without colons.
 */

export const GRAND_MASTER_UID =
  process.env.MASTER_UID_ALL?.trim().toUpperCase() || "04:FF:FF:FF:FF:FF:00";

export const INDIVIDUAL_MASTER_UIDS: string[] = [
  process.env.MASTER_UID_L1?.trim().toUpperCase() || "04:01:00:00:00:00:01",
  process.env.MASTER_UID_L2?.trim().toUpperCase() || "04:02:00:00:00:00:02",
  process.env.MASTER_UID_L3?.trim().toUpperCase() || "04:03:00:00:00:00:03",
  process.env.MASTER_UID_L4?.trim().toUpperCase() || "04:04:00:00:00:00:04",
  process.env.MASTER_UID_L5?.trim().toUpperCase() || "04:05:00:00:00:00:05",
  process.env.MASTER_UID_L6?.trim().toUpperCase() || "04:06:00:00:00:00:06",
  process.env.MASTER_UID_L7?.trim().toUpperCase() || "04:07:00:00:00:00:07",
  process.env.MASTER_UID_L8?.trim().toUpperCase() || "04:08:00:00:00:00:08",
  process.env.MASTER_UID_L9?.trim().toUpperCase() || "04:09:00:00:00:00:09",
  process.env.MASTER_UID_L10?.trim().toUpperCase() || "04:10:00:00:00:00:10",
  process.env.MASTER_UID_L11?.trim().toUpperCase() || "04:11:00:00:00:00:11",
  process.env.MASTER_UID_L12?.trim().toUpperCase() || "04:12:00:00:00:00:12",
];

export interface MasterKeyInfo {
  isMaster: boolean;
  isGrandMaster: boolean;
  lockerNumber: number | null; // 1-12 or null
  forcedByLabel: string; // "MASTER_ALL" or "MASTER_KEY"
  keyDescription: string;
}

/**
 * Normalizes any UID string by stripping colons, hyphens, and whitespace,
 * returning an uppercase hexadecimal string.
 */
export function normalizeUid(rawUid: string): string {
  return (rawUid || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
}

/**
 * Checks whether a given NFC UID belongs to the 13 fixed Master Keys.
 */
export function checkMasterKey(rawUid: string): MasterKeyInfo {
  const clean = normalizeUid(rawUid);
  if (!clean) {
    return {
      isMaster: false,
      isGrandMaster: false,
      lockerNumber: null,
      forcedByLabel: "",
      keyDescription: "",
    };
  }

  // 1. Check Grand Master (Opens all 12 lockers)
  if (clean === normalizeUid(GRAND_MASTER_UID)) {
    return {
      isMaster: true,
      isGrandMaster: true,
      lockerNumber: null,
      forcedByLabel: "MASTER_ALL",
      keyDescription: "GRAND MASTER KEY (ALL 12 BAYS)",
    };
  }

  // 2. Check 12 Individual Master Keys
  for (let idx = 0; idx < INDIVIDUAL_MASTER_UIDS.length; idx++) {
    if (clean === normalizeUid(INDIVIDUAL_MASTER_UIDS[idx])) {
      const lockerNum = idx + 1;
      return {
        isMaster: true,
        isGrandMaster: false,
        lockerNumber: lockerNum,
        forcedByLabel: "MASTER_KEY",
        keyDescription: `INDIVIDUAL MASTER KEY (BAY L-${String(lockerNum).padStart(2, "0")})`,
      };
    }
  }

  return {
    isMaster: false,
    isGrandMaster: false,
    lockerNumber: null,
    forcedByLabel: "",
    keyDescription: "",
  };
}

/**
 * Returns formatted registry metadata for all 13 Master Keys.
 */
export function getAllMasterKeysRegistry() {
  return [
    {
      id: "grand-master",
      type: "GRAND_MASTER" as const,
      lockerTarget: "ALL L01 to L12",
      uid: GRAND_MASTER_UID,
      label: "FIRE KEY",
      description: "Opens all lockers sequentially.",
    },
    ...INDIVIDUAL_MASTER_UIDS.map((uid, idx) => ({
      id: `master-l${idx + 1}`,
      type: "INDIVIDUAL_MASTER" as const,
      lockerTarget: `L${String(idx + 1).padStart(2, "0")}`,
      uid,
      label: `MASTER KEY L${idx + 1}`,
    })),
  ];
}
