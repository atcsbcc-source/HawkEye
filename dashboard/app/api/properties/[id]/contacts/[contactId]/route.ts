import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { mockDeleteContact, mockUpdateContact } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { ContactPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: { id: string; contactId: string } };

/** PATCH /api/properties/[id]/contacts/[contactId] */
export const PATCH = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("contacts:patch", user.id, 240);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, ContactPatch, { maxBytes: 16_384 });
  if (!body.ok) return body.res;
  const patch: Record<string, unknown> = { ...body.data };
  for (const k of ["phone", "email", "mailing_address", "preferred_channel", "source", "notes"]) {
    if (k in patch && !patch[k]) patch[k] = null;
  }
  if (Object.keys(patch).length === 0) return apiError("No editable fields supplied", 400);

  const db = getServiceSupabase();
  let contact: unknown;
  if (db) {
    const { data, error } = await db
      .from("contacts")
      .update(patch)
      .eq("id", params.contactId)
      .eq("property_id", params.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error("[contacts] update failed", error.code);
      return apiError("Could not update the contact", 500);
    }
    if (!data) return apiError("Contact not found", 404);
    contact = data;
  } else {
    contact = mockUpdateContact(params.id, params.contactId, patch);
    if (!contact) return apiError("Contact not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "contact.updated",
    subjectType: "property",
    subjectId: params.id,
    detail: { contact_id: params.contactId, fields: Object.keys(patch) },
  });
  return NextResponse.json({ contact });
});

/** DELETE /api/properties/[id]/contacts/[contactId] — hard delete; activities keep their text. */
export const DELETE = withAuth<Params>(async (_req, user, { params }) => {
  const rl = rateLimit("contacts:delete", user.id, 60);
  if (!rl.ok) return rateLimitResponse(rl);

  const db = getServiceSupabase();
  if (db) {
    const { data, error } = await db
      .from("contacts")
      .delete()
      .eq("id", params.contactId)
      .eq("property_id", params.id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[contacts] delete failed", error.code);
      return apiError("Could not delete the contact", 500);
    }
    if (!data) return apiError("Contact not found", 404);
  } else if (!mockDeleteContact(params.id, params.contactId)) {
    return apiError("Contact not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "contact.deleted",
    subjectType: "property",
    subjectId: params.id,
    detail: { contact_id: params.contactId },
  });
  return NextResponse.json({ ok: true });
});
