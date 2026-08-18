import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// Every password field in the app was type="password" with no way to check
// what you'd typed -- real friction on mobile, especially on ChangePassword,
// which every new player is forced through on first login before they can
// do anything else.
export default function PasswordInput({ className = "", ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input type={visible ? "text" : "password"} className={`input-field pr-12 ${className}`} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="icon-btn absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
