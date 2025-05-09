import { useState, useEffect } from "react";
import { windowAppURLState } from "@lichtblick/suite-base/util/appURLState";

// Matches strings like "ailog_FFCAFF00-0998-410B-BF84-B96917AB1B01_2022_03_03-12_05_38"
const LOG_NAME_REGEX = /ailog_([A-Z0-9-]+)_(\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2})/;

/**
 * Hook to derive the current log_name from the URL's dsParams.url.
 * Updates on initial mount and whenever the URL changes (popstate).
 * Returns the matched log_name, or an empty string if none.
 */
export function useLogName(): string {
  const deriveLogName = (): string => {
    const dsUrl = windowAppURLState()?.dsParams?.url;
    const match = dsUrl?.match(LOG_NAME_REGEX);
    return match?.[0] ?? "";
  };

  const [logName, setLogName] = useState<string>(() => deriveLogName());

  useEffect(() => {
    const handleUrlChange = () => {
      setLogName(deriveLogName());
    };
    window.addEventListener("popstate", handleUrlChange);
    // Also listen for pushState/replaceState if needed (optional)
    return () => {
      window.removeEventListener("popstate", handleUrlChange);
    };
  }, []);

  return logName;
}
