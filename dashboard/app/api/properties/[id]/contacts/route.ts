import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchContacts } from "@/lib/crm-data";
import { mockCreateContact } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { ContactCreate } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** GET /api/properties/[id]/contacts */
export const GET = withAuth<Params>(async (_req, _user, { params }) => {
  return NextResponse.json({ contacts: await fetchContacts(params.id) });
});

/** POST /api/properties/[id]/contacts — 201 with the new contact. */
export const POST = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("contacts:post", user.id, 120);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, ContactCreate, { maxBytes: 16_384 });
  if (!body.ok) return body.res;
  const d = body.data;
  const input = {
    name: d.name,
    role: d.role as Contact["role"],
    phone: d.phone || null,
    email: d.email || null,
    mailing_address: d.mailing_address || null,
    preferred_channel: (d.preferred_channel || null) as Contact["preferred_channel"],
    do_not_contact: d.do_not_contact,
    source: d.source || null,
    notes: d.notes || null,
  };

  const db = getServiceSupabase();
  let contact: unknown;
  if (db) {
    const { data: existing } = await db
      .from("properties")
      .select("id")
      .eq("id", params.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!existing) return apiError("Property not found", 404);
    const { data, error } = await db
      .from("contacts")
      .insert({ ...input, property_id: params.id })
      .select()
      .single();
    if (error || !data) {
      console.error("[contacts] insert failed", error?.code);
      return apiError("Could not create the contact", 500);
    }
    contact = data;
  } else {
    contact = mockCreateContact(params.id, input);
    if (!contact) return apiError("Property not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "contact.created",
    subjectType: "property",
    subjectId: params.id,
    detail: { role: input.role, do_not_contact: input.do_not_contact },
  });
  return NextResponse.json({ contact }, { status: 201 });
});
