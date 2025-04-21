// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useMemo } from "react";

import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import showOpenFilePicker, {
  showDirectoryPicker,
} from "@lichtblick/suite-base/util/showOpenFilePicker";

// Store the most recently selected folder name
// This is a simple global variable to minimize code changes
let lastSelectedFolderName: string | undefined;

export function useOpenFile(sources: readonly IDataSourceFactory[]): () => Promise<void> {
  const { selectSource } = usePlayerSelection();

  const allExtensions = useMemo(() => {
    return sources.reduce<string[]>((all, source) => {
      if (!source.supportedFileTypes) {
        return all;
      }

      return [...all, ...source.supportedFileTypes];
    }, []);
  }, [sources]);

  return useCallback(async () => {
    // Use directory picker instead of file picker
    const dirHandle = await showDirectoryPicker();
    if (!dirHandle) {
      return;
    }

    // Store the folder name for later use in PlayerManager
    lastSelectedFolderName = dirHandle.name;

    // Assume onering.mcap exists in the selected directory
    try {
      const fileHandle = await dirHandle.getFileHandle("onering.mcap");
      const file = await fileHandle.getFile();

      // Find the McapLocalDataSourceFactory to handle this file
      const mcapSource = sources.find(
        (source) => source.id === "mcap-local-file" && source.supportedFileTypes?.includes(".mcap"),
      );

      if (!mcapSource) {
        throw new Error("Cannot find MCAP data source to handle the file");
      }

      // Use the standard mechanism to select the source
      selectSource(mcapSource.id, { type: "file", handle: fileHandle });
    } catch (error) {
      console.error("Error accessing onering.mcap in the selected directory:", error);
      throw new Error("Could not find onering.mcap in the selected directory");
    }
  }, [selectSource, sources]);
}

// Export the function to get the last selected folder name
export function getLastSelectedFolderName(): string | undefined {
  return lastSelectedFolderName;
}
