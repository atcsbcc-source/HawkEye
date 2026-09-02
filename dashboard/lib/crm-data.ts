import { getSupabase } from "./supabase";
import { fetchLeads } from "./data";
import { buildWorkQueue, type WorkItem } from "./crm";
import { mockListActivities, mockListContacts, mockListOpenTasks } from "./server/mock-store";
import type { Activity, Contact } from "./types";

/** Contacts for one parcel, oldest first. */
export async function fetchContacts(propertyId: string): Promise<Contact[]> {
  const db = getSupabase();
  if (!db) return mockListContacts(propertyId);
  const { data } = await db
    .from("contacts")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Contact[];
}

/** Timeline for one parcel, newest first. */
export async function fetchActivities(propertyId: string): Promise<Activity[]> {
  const db = getSupabase();
  if (!db) return mockListActivities(propertyId);
  const { data } = await db
    .from("activities")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Activity[]).map(normalizeActivity);
}

/** Every open task across the portfolio, soonest due first. */
export async function fetchOpenTasks(): Promise<Activity[]> {
  const db = getSupabase();
  if (!db) return mockListOpenTasks();
  const { data } = await db
    .from("activities")
    .select("*")
    .eq("kind", "task")
    .is("completed_at", null)
    .order("due_at", { ascending: true });
  return ((data ?? []) as Activity[]).map(normalizeActivity);
}

/** Open tasks + next actions, bucketed (see lib/crm.ts buildWorkQueue). */
export async function fetchWorkQueue(now = Date.now()): Promise<WorkItem[]> {
  const [leads, tasks] = await Promise.all([fetchLeads(), fetchOpenTasks()]);
  return buildWorkQueue(leads, tasks, now);
}

function normalizeActivity(a: Activity): Activity {
  return { ...a, amount: a.amount == null ? null : Number(a.amount) };
}
