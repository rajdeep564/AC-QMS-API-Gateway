export function batchLink(batchId: string): string {
  return `/qc/batches/${batchId}`;
}

export function documentLink(batchId: string, documentId: string): string {
  return `/qc/batches/${batchId}/documents/${documentId}`;
}

export function masterLink(masterId: string): string {
  return `/qc/masters/${masterId}`;
}

export function specTemplateLink(templateId: string): string {
  return `/qc/spec-templates/${templateId}`;
}
