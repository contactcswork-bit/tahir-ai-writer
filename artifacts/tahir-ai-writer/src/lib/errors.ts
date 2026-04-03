/**
 * Central error handling utilities.
 * Extracts user-friendly messages from ApiError, network errors, and other exceptions.
 */

interface ApiErrorLike {
  status?: number;
  data?: unknown;
  message: string;
}

function isApiError(err: unknown): err is ApiErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as any).status === "number"
  );
}

/**
 * Returns a clean, user-friendly error message from any thrown value.
 */
export function getErrorMessage(err: unknown): string {
  // Network / fetch failure — no internet or server unreachable
  if (
    err instanceof TypeError &&
    (err.message.toLowerCase().includes("fetch") ||
      err.message.toLowerCase().includes("network") ||
      err.message.toLowerCase().includes("failed to fetch"))
  ) {
    return "Cannot connect to the server. Please check your internet connection and try again.";
  }

  if (isApiError(err)) {
    const status = err.status!;

    // Extract the detail text after "HTTP xxx StatusText: "
    const rawMessage = err.message || "";
    const colonIdx = rawMessage.indexOf(": ");
    const detail =
      colonIdx !== -1 ? rawMessage.slice(colonIdx + 2).trim() : rawMessage;

    // Also try to read the data payload for a nested error field
    const dataError =
      typeof (err as any).data === "object" &&
      (err as any).data !== null &&
      typeof (err as any).data.error === "string"
        ? (err as any).data.error
        : null;

    const message = dataError || detail || rawMessage;

    switch (status) {
      case 400:
        return message || "Invalid request — please check your inputs.";
      case 401:
        if (
          message.toLowerCase().includes("invalid") ||
          message.toLowerCase().includes("email") ||
          message.toLowerCase().includes("password") ||
          message.toLowerCase().includes("credentials")
        ) {
          return "Incorrect email or password. Please try again.";
        }
        return "Your session has expired. Please log in again.";
      case 403:
        return "You don't have permission to perform this action.";
      case 404:
        return message || "The requested item was not found.";
      case 409:
        return message || "A conflict occurred — this item may already exist.";
      case 422:
        return message || "The submitted data is invalid. Please check your inputs.";
      case 429:
        return "Too many requests. Please wait a moment and try again.";
      case 500:
        return message.includes("Internal")
          ? "A server error occurred. Please try again in a moment."
          : message || "Server error. Please try again.";
      case 502:
      case 503:
      case 504:
        return "The server is temporarily unavailable. Please try again shortly.";
      default:
        return message || `Request failed (HTTP ${status})`;
    }
  }

  if (err instanceof Error) {
    return err.message || "An unexpected error occurred.";
  }

  if (typeof err === "string" && err.trim()) {
    return err;
  }

  return "An unexpected error occurred. Please try again.";
}

/**
 * Returns a short title for the error type.
 */
export function getErrorTitle(err: unknown): string {
  if (
    err instanceof TypeError &&
    (err.message.toLowerCase().includes("fetch") ||
      err.message.toLowerCase().includes("network"))
  ) {
    return "Connection Error";
  }

  if (isApiError(err)) {
    const status = err.status!;
    if (status === 401) return "Login Failed";
    if (status === 403) return "Access Denied";
    if (status === 404) return "Not Found";
    if (status === 409) return "Conflict";
    if (status === 429) return "Rate Limited";
    if (status >= 500) return "Server Error";
    return "Error";
  }

  return "Error";
}

/**
 * Convenience: returns { title, description } ready for useToast().
 */
export function toastError(err: unknown): { title: string; description: string; variant: "destructive" } {
  return {
    title: getErrorTitle(err),
    description: getErrorMessage(err),
    variant: "destructive",
  };
}
