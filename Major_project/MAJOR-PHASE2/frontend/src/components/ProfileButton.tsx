import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

export default function ProfileButton() {
  const { user, api } = useAuth();
  const navigate = useNavigate();
  const [photoUrl, setPhotoUrl] = useState<string>("");

  useEffect(() => {
    const loadPhoto = async () => {
      if (user?.id && user.hasProfilePhoto) {
        try {
          const response = await api.get(`/auth/users/${user.id}/photo`, {
            responseType: "blob",
          });
          const url = URL.createObjectURL(response.data);
          setPhotoUrl(url);
        } catch {
          // Use default avatar
        }
      }
    };
    loadPhoto();
  }, [user, api]);

  if (!user) return null;

  const getProfileRoute = () => {
    switch (user.role) {
      case "owner":
        return "/owner-profile";
      case "dealer":
        return "/dealer-profile";
      case "rto":
        return "/rto-profile";
      case "police":
        return "/police-profile";
      default:
        return "/";
    }
  };

  const handleClick = () => {
    navigate(getProfileRoute());
  };

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
      title="View Profile"
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid #fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: photoUrl
            ? "transparent"
            : "linear-gradient(135deg, #1e5aa8 0%, #16437e 100%)",
        }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt="Profile"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <span
            style={{ color: "#fff", fontSize: "1.2rem", fontWeight: "bold" }}
          >
            {user.name?.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </button>
  );
}
