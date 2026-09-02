import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import { isVoter } from "../utils/roles";
import { isPushSupported, subscribeToPush } from "../utils/pushNotifications";

// Per-device, not per-session — sessionStorage would re-nag every new tab,
// and a dismissal is a "not now" for this device, not this login.
const DISMISSED_KEY = "bcc_push_prompt_dismissed";

// Shown once, app-wide (mounted alongside <Footer /> in App.jsx so it
// survives route changes) to any logged-in voter who hasn't already
// granted or denied notification permission and hasn't dismissed this
// banner before. Silently renders nothing for admins, unsupported
// browsers, or anyone who's already been asked.
export default function NotificationPrompt() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !isVoter(user)) return setVisible(false);
    if (!isPushSupported()) return setVisible(false);
    if (Notification.permission !== "default") return setVisible(false);
    if (localStorage.getItem(DISMISSED_KEY) === "1") return setVisible(false);
    setVisible(true);
  }, [user]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    setLoading(true);
    try {
      const result = await subscribeToPush();
      if (result === "granted") {
        toast.success("Notifications enabled — you'll be pinged when voting opens!");
      } else if (result === "denied") {
        toast.error("Notifications blocked. You can re-enable them in your browser/app settings.");
      }
    } catch {
      toast.error("Couldn't enable notifications — please try again.");
    } finally {
      setLoading(false);
      setVisible(false);
      localStorage.setItem(DISMISSED_KEY, "1");
    }
  };

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-sm safe-bottom">
      <div className="card flex items-start gap-3 shadow-lg">
        <Bell className="w-5 h-5 text-pitch-700 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-gray-900">Get notified when voting opens</p>
          <p className="text-gray-500 text-xs mt-0.5">We'll ping you the moment a new match's voting window starts.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={enable} disabled={loading} className="btn-primary text-xs px-3 py-1.5">
              {loading ? "Enabling…" : "Enable"}
            </button>
            <button onClick={dismiss} className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-600">
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="text-gray-300 hover:text-gray-500">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
