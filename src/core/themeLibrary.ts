import { invoke } from "@tauri-apps/api/core";
import {
  parseThemeFile,
  serializeThemeFile,
  themeFileNameFor,
  type WorkspaceThemeFile,
} from "./themeFile";

export type ThemeLibraryEntry = {
  fileName: string;
  theme: WorkspaceThemeFile | null;
  error: string | null;
};

export type ThemeLibrarySnapshot = {
  directory: string;
  entries: ThemeLibraryEntry[];
};

type ThemeLibraryListing = {
  directory: string;
  files: Array<{ fileName: string; text: string }>;
};

export async function listThemeLibrary(): Promise<ThemeLibrarySnapshot> {
  const listing = await invoke<ThemeLibraryListing>("theme_library_list");
  return {
    directory: listing.directory,
    entries: listing.files.map((file) => {
      const parsed = parseThemeFile(file.text);
      return parsed.ok
        ? { fileName: file.fileName, theme: parsed.theme, error: null }
        : { fileName: file.fileName, theme: null, error: parsed.error };
    }),
  };
}

export async function saveThemeToLibrary(theme: WorkspaceThemeFile): Promise<string> {
  const fileName = themeFileNameFor(theme.name);
  await invoke("theme_library_write", { fileName, text: serializeThemeFile(theme) });
  return fileName;
}

export async function deleteThemeFromLibrary(fileName: string): Promise<void> {
  await invoke("theme_library_delete", { fileName });
}
