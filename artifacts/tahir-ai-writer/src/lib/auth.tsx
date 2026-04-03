import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "@workspace/api-client-react";
import { useGetMe, useLogin, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { LoginRequest } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  
  // We use the useGetMe hook to fetch the user if token exists.
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  
  const { data: user, isLoading: isUserLoading, refetch: refetchUser, isError } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (isError) {
      localStorage.removeItem("auth_token");
      setLocation("/login");
    }
  }, [isError, setLocation]);

  const login = async (data: LoginRequest) => {
    try {
      const res = await loginMutation.mutateAsync({ data });
      localStorage.setItem("auth_token", res.token);
      await refetchUser();
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
      throw error;
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await logoutMutation.mutateAsync();
      }
    } catch (e) {
      // Ignore
    } finally {
      localStorage.removeItem("auth_token");
      setLocation("/login");
      window.location.reload();
    }
  };

  // isLoading should be true if we have a token but user data hasn't loaded yet
  const isLoading = !!token && isUserLoading;

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
