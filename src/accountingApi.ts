const BASE_URL = process.env.ACCOUNTING_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.ACCOUNTING_API_KEY ?? "";

export interface Partner {
  partner_code: string;
  name: string;
  aliases: string[];
  registration_no: string;
}

interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
}

export async function getPartners(): Promise<Partner[]> {
  const res = await fetch(`${BASE_URL}/partners`, {
    headers: { "X-API-Key": API_KEY },
  });
  const body = (await res.json()) as ApiEnvelope<{ partners: Partner[] }>;
  if (!body.success || !body.data) {
    throw new Error(`GET /partners failed: ${body.error?.code} ${body.error?.message}`);
  }
  return body.data.partners;
}
