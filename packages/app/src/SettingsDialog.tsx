import { Minus, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EDITOR_WIDTH_LABELS,
  type EditorWidth,
  FONT_FAMILY_LABELS,
  type FontFamily,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  THEME_LABELS,
  type Theme,
} from "./preferences";
import { usePreferences } from "./usePreferences";

const THEME_OPTIONS: Theme[] = ["light", "warm", "dark", "system"];
const FONT_FAMILY_OPTIONS: FontFamily[] = ["sans", "serif", "mono"];
const WIDTH_OPTIONS: EditorWidth[] = ["normal", "wide"];

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const { preferences, update } = usePreferences();

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Appearance settings"
            data-testid="settings-trigger"
          >
            <Settings className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>
            Customize the theme and reading font. Changes apply immediately and
            are saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <SettingRow label="Theme">
            <Select<Theme>
              value={preferences.theme}
              onValueChange={(value) => {
                if (value) update({ theme: value });
              }}
            >
              <SelectTrigger
                data-testid="settings-theme-trigger"
                aria-label="Theme"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    label={THEME_LABELS[value]}
                    data-testid={`settings-theme-${value}`}
                  >
                    <SelectItemText>{THEME_LABELS[value]}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Font">
            <Select<FontFamily>
              value={preferences.fontFamily}
              onValueChange={(value) => {
                if (value) update({ fontFamily: value });
              }}
            >
              <SelectTrigger
                data-testid="settings-font-family-trigger"
                aria-label="Font family"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILY_OPTIONS.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    label={FONT_FAMILY_LABELS[value]}
                    data-testid={`settings-font-family-${value}`}
                  >
                    <SelectItemText>{FONT_FAMILY_LABELS[value]}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Width">
            <Select<EditorWidth>
              value={preferences.width}
              onValueChange={(value) => {
                if (value) update({ width: value });
              }}
            >
              <SelectTrigger
                data-testid="settings-width-trigger"
                aria-label="Editor width"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WIDTH_OPTIONS.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    label={EDITOR_WIDTH_LABELS[value]}
                    data-testid={`settings-width-${value}`}
                  >
                    <SelectItemText>
                      {EDITOR_WIDTH_LABELS[value]}
                    </SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Font size">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label="Decrease font size"
                data-testid="settings-font-size-decrease"
                disabled={preferences.fontSize <= MIN_FONT_SIZE}
                onClick={() => update({ fontSize: preferences.fontSize - 1 })}
              >
                <Minus className="size-3.5" aria-hidden="true" />
              </Button>
              <span
                data-testid="settings-font-size-value"
                className="min-w-12 text-center font-mono text-sm tabular-nums text-foreground"
              >
                {preferences.fontSize}px
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Increase font size"
                data-testid="settings-font-size-increase"
                disabled={preferences.fontSize >= MAX_FONT_SIZE}
                onClick={() => update({ fontSize: preferences.fontSize + 1 })}
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </SettingRow>
        </div>
      </DialogContent>
    </Dialog>
  );
}
