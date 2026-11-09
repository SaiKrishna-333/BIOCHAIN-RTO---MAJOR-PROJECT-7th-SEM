import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import api from "../services/api";
import { AuthContext, type User } from "./authTypes";
import {
  initializeSocket,
  disconnectSocket,
  joinRoom,
  joinRoleRoom,
} from "../services/socketService";

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = () => {
      const token = localStorage.getItem("token");
      if (token) {
        try {
          const storedUser = JSON.parse(localStorage.getItem("user") || "null");
          if (storedUser) {
            setUser(storedUser);
            // Initialize socket connection
            initializeSocket(token);
            joinRoom(storedUser.id);
            joinRoleRoom(storedUser.role);
          }
        } catch (error) {
          // Unreadable stored user: start signed out rather than half-signed-in.
          console.warn("Stored user could not be read, signing out:", error);
          localStorage.removeItem("user");
          localStorage.removeItem("token");
        }
      }
      setLoading(false);
    };

    // Use setTimeout to move setState out of the effect
    setTimeout(initializeAuth, 0);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    const { token, user } = res.data;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    setUser(user);
    // Initialize socket connection after login
    initializeSocket(token);
    joinRoom(user.id);
    joinRoleRoom(user.role);
    return user;
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    disconnectSocket();
    setUser(null);
  };

  // A page that has just written account facts (dealer or RTO details) merges
  // them into the live user and the stored copy. Without this the only way to
  // see the saved values was a full window reload, which also threw away the
  // confirmation message the page had just shown.
  const refreshUser = (changes: Partial<User>) => {
    setUser((current) => {
      if (!current) return current;
      const updated = { ...current, ...changes };
      localStorage.setItem("user", JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, refreshUser, loading, api }}
    >
      {children}
    </AuthContext.Provider>
  );
};
