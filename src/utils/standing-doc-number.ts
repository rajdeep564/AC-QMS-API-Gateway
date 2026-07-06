export function formatStandingSpecNo(productCode: string, revisionNo: number): string {
  const rev = String(revisionNo).padStart(2, "0");
  return `SPEC/${productCode}/${rev}`;
}

export function formatStandingMoaNo(productCode: string, revisionNo: number): string {
  const rev = String(revisionNo).padStart(2, "0");
  return `MOA/${productCode}/${rev}`;
}
