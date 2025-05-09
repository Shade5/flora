import { useState, useEffect } from "react";
import { windowAppURLState } from "../util/appURLState";

// Regex to extract the log name from a URL (last path segment before query)

export function useLogName(): string {
    const deriveLogName = (): string => {
        const dsUrl = windowAppURLState()?.dsParams?.url;
        const logname = dsUrl?.match(/ailog_([A-Z0-9-]+)_(\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2})/)?.[0] ?? "";
        return logname;
    };

    const [logName, setLogName] = useState<string>(() => deriveLogName());

    useEffect(() => {
        const handleUrlChange = () => {
            setLogName(deriveLogName());
        };
        window.addEventListener("popstate", handleUrlChange);
        return () => {
            window.removeEventListener("popstate", handleUrlChange);
        };
    }, []);

    return logName;
}
