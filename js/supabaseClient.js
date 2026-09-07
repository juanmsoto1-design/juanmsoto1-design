// Cliente único de Supabase, compartido por toda la app
window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// Redirige a login si no hay sesión activa. Devuelve la sesión si existe.
async function requireSession() {
  const { data: { session } } = await window.sb.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

// Obtiene (o crea) el perfil del usuario autenticado
async function getMyProfile() {
  const { data: { user } } = await window.sb.auth.getUser();
  if (!user) return null;
  let { data, error } = await window.sb.from("profiles").select("*").eq("id", user.id).single();
  if (error && !data) {
    // el trigger pudo tardar un instante en crear el perfil; reintenta una vez
    await new Promise(r => setTimeout(r, 800));
    const retry = await window.sb.from("profiles").select("*").eq("id", user.id).single();
    data = retry.data;
  }
  return data;
}

async function logout() {
  await window.sb.auth.signOut();
  window.location.href = "index.html";
}
