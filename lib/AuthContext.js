"use client";

import { createContext, useCallback, useContext, useState, useEffect } from "react";

const AuthContext = createContext({ user: null, loading: true, loginStateLocally: () => {}, logoutLocally: () => {}, refreshUser: async () => null });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Hydrate from localStorage or an endpoint (simpler: use a /api/auth/me)
  // For simplicity, we just keep state based on login success and assume a generic whoami endpoint
  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => res.json())
      .then(data => {
        if (data.user) setUser(data.user);
        setLoading(false);
      })
      .catch((err) => {
        setLoading(false);
      });
  }, []);

  const loginStateLocally = (userData) => {
    setUser(userData);
  };

  // Re-reads the signed-in user from the server, e.g. after sign-in or after
  // MFA changes, so flags like mfaEnabled and adminMfaRequired are current.
  const refreshUser = useCallback(async () => {
    try {
      const data = await (await fetch("/api/auth/me")).json();
      setUser(data.user || null);
      return data.user || null;
    } catch {
      return null;
    }
  }, []);

  const logoutLocally = () => {
    fetch("/api/auth/logout", { method: "POST" })
      .then(() => setUser(null));
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginStateLocally, logoutLocally, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
