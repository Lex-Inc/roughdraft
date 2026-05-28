import { useCallback, useState } from "react";
import {
  applyPreferences,
  clampFontSize,
  loadPreferences,
  type Preferences,
  savePreferences,
} from "./preferences";

/**
 * Live appearance preferences for the settings UI. Updates apply to the
 * document and persist immediately. System-theme OS changes are handled
 * globally in main.tsx, so this hook only needs to react to user edits.
 */
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() =>
    loadPreferences(),
  );

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((previous) => {
      const next: Preferences = {
        ...previous,
        ...patch,
        fontSize:
          patch.fontSize !== undefined
            ? clampFontSize(patch.fontSize)
            : previous.fontSize,
      };
      applyPreferences(next);
      savePreferences(next);
      return next;
    });
  }, []);

  return { preferences, update };
}
