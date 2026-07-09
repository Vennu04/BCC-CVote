import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../utils/api";
import { getDeviceId } from "../utils/device";

const AuthContext = createContext(null);

// sessionStorage (not localStorage) is deliberate — localStorage is shared across
// every tab of the same origin, so logging into a second account in another tab
// would silently overwrite the first tab's identity too (both tabs' requests would
// then authenticate as whoever logged in last). sessionStorage is per-tab, so
// admin + two captains can each be logged in in their own tab simultaneously.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("bcc_user"));
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const token = sessionStorage.getItem("bcc_token");
    if (!token) { setLoading(false); return; }
    api.get("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => { sessionStorage.removeItem("bcc_token"); sessionStorage.removeItem("bcc_user"); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (team_code, password) => {
    const res = await api.post("/auth/login", { team_code, password, device_id: getDeviceId() });
    const { access_token, user: userData } = res.data;
    sessionStorage.setItem("bcc_token", access_token);
    sessionStorage.setItem("bcc_user", JSON.stringify(userData));
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch {}
    sessionStorage.removeItem("bcc_token");
    sessionStorage.removeItem("bcc_user");
    setUser(null);
  }, []);

  // Re-pulls /auth/me and syncs sessionStorage — used after a password change
  // so `user.must_change_password` flips to false without a full re-login.
  const refreshMe = useCallback(async () => {
    const res = await api.get("/auth/me");
    sessionStorage.setItem("bcc_user", JSON.stringify(res.data));
    setUser(res.data);
    return res.data;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshMe, loading, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};
