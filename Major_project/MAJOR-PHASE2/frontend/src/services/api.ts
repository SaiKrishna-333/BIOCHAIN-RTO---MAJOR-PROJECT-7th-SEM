import axios from "axios";

// One place decides where the API lives: .env's VITE_API_URL when set, the local
// backend otherwise.
const API_BASE = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api`;

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => Promise.reject(error));

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && localStorage.getItem("token")) {
      // Session is gone: drop the stale token and land on the login page once,
      // not on the 401 that a failing background poll may return.
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }

    // Replace axios' generic text ("Request failed with status code 403") with the
    // reason the API actually returned, so every alert/dialog explains what failed.
    const serverMessage =
      error.response?.data?.message || error.response?.data?.error;
    if (serverMessage && error) {
      error.message = String(serverMessage);
    }

    return Promise.reject(error);
  }
);

export default api;