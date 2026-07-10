import { COMPANY_NAME } from "../config/appMeta";

export default function Footer() {
  return (
    <footer className="text-center text-xs text-gray-400 py-4 px-4">
      © {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
    </footer>
  );
}
