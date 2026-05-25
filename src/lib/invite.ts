import { supabase } from "./supabase";
import type { AppRole } from "../types";

export type InviteUserPayload = {
  full_name: string;
  initials: string;
  email: string;
  role: AppRole;
};

export async function inviteUser(payload: InviteUserPayload) {
  if (!supabase) throw new Error("Supabase environment variables are not configured.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) throw new Error("You must be signed in to invite users.");

  const response = await fetch("/api/invite-user", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };

  if (!response.ok) {
    throw new Error(result.error ?? "Unable to invite user.");
  }

  return result.message ?? "Invitation sent.";
}
