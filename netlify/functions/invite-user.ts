import { createClient } from "@supabase/supabase-js";

type InvitePayload = {
  full_name?: string;
  initials?: string;
  email?: string;
  role?: "admin" | "standard" | "viewer";
};

const allowedRoles = new Set(["admin", "standard", "viewer"]);

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getSupabaseUrl() {
  return Netlify.env.get("SUPABASE_URL") || Netlify.env.get("VITE_SUPABASE_URL");
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Invite service is not configured." }, 500);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return jsonResponse({ error: "Missing user session." }, 401);
  }

  const payload = (await request.json().catch(() => null)) as InvitePayload | null;
  const email = payload?.email?.trim().toLowerCase();
  const fullName = payload?.full_name?.trim();
  const initials = payload?.initials?.trim().toUpperCase() || null;
  const role = payload?.role ?? "standard";

  if (!email || !fullName || !allowedRoles.has(role)) {
    return jsonResponse({ error: "Full name, email, and a valid role are required." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);

  if (callerError || !callerData.user?.email) {
    return jsonResponse({ error: "Invalid user session." }, 401);
  }

  const { data: callerStaff, error: staffError } = await adminClient
    .from("staff_members")
    .select("role,is_active")
    .ilike("email", callerData.user.email)
    .single();

  if (staffError || callerStaff?.role !== "admin" || !callerStaff.is_active) {
    return jsonResponse({ error: "Only active admins can invite users." }, 403);
  }

  const redirectTo = new URL("/", request.url).toString();
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: fullName,
      role,
    },
  });

  if (inviteError) {
    return jsonResponse({ error: inviteError.message }, 400);
  }

  const { error: profileError } = await adminClient.from("staff_members").upsert(
    {
      full_name: fullName,
      initials,
      email,
      role,
      is_active: true,
    },
    { onConflict: "email" },
  );

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500);
  }

  return jsonResponse({
    message: `Invitation sent to ${email}.`,
  });
};

export const config = {
  path: "/api/invite-user",
};
