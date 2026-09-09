const BASE_URL = process.env.ACCOUNTING_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.ACCOUNTING_API_KEY ?? "";

export interface Partner {
  partner_code: string;
  name: string;
  aliases: string[];
  registration_no: string;
}

export interface ApiError {
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

export interface RegisteredInvoice {
  accounting_id: string;
  partner_code: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  line_count: number;
}

export async function getRegisteredInvoices(): Promise<RegisteredInvoice[]> {
  const res = await fetch(`${BASE_URL}/invoices`, {
    headers: { "X-API-Key": API_KEY },
  });
  const body = (await res.json()) as ApiEnvelope<{ invoices: RegisteredInvoice[] }>;
  if (!body.success || !body.data) {
    throw new Error(`GET /invoices failed: ${body.error?.code} ${body.error?.message}`);
  }
  return body.data.invoices;
}

export interface InvoiceLinePayload {
  description: string;
  quantity: number | null;
  unit: string;
  unit_price: number | null;
  amount: number;
  tax_code: string;
}

export interface InvoicePayload {
  partner_code: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  currency: "JPY";
  lines: InvoiceLinePayload[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
}

export interface PostInvoiceResult {
  status: number;
  success: boolean;
  data: RegisteredInvoice | null;
  error: ApiError | null;
}

export async function postInvoice(payload: InvoicePayload): Promise<PostInvoiceResult> {
  const res = await fetch(`${BASE_URL}/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as ApiEnvelope<RegisteredInvoice>;
  return { status: res.status, success: body.success, data: body.data, error: body.error };
}
