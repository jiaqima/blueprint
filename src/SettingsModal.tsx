import { useEffect, useState } from "react";
import {
  fetchWorkspaceConfig,
  saveWorkspaceConfig,
  type WorkspaceConfig,
} from "./sync";

type Props = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: Props) {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchWorkspaceConfig().then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r) {
        setConfig(r);
        // Pre-fill the input with the resolved path so the user can
        // edit a copy. (Could prefer the raw config-file value here, but
        // we don't currently expose it; the resolved path is at least
        // unambiguous.)
        setInput(r.workspace);
      } else {
        setError("Could not load workspace config (dev server reachable?).");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const envOverride = config?.envOverride ?? null;
  const inputDisabled = busy || !!envOverride || loading;

  const onSave = async () => {
    if (inputDisabled) return;
    setBusy(true);
    setError(null);
    const result = await saveWorkspaceConfig(input);
    setBusy(false);
    if (result === "env-override") {
      setError(
        "BLUEPRINT_WORKSPACE env var is set — UI changes can't apply until you unset it.",
      );
      return;
    }
    if (!result) {
      setError("Save failed. Check the dev server console.");
      return;
    }
    onClose();
  };

  const onReset = async () => {
    if (inputDisabled) return;
    setBusy(true);
    setError(null);
    const result = await saveWorkspaceConfig(null);
    setBusy(false);
    if (result === "env-override") {
      setError(
        "BLUEPRINT_WORKSPACE env var is set — UI changes can't apply until you unset it.",
      );
      return;
    }
    if (!result) {
      setError("Reset failed. Check the dev server console.");
      return;
    }
    onClose();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <h3>Settings — Workspace</h3>

        {loading ? (
          <p className="modal__hint">Loading…</p>
        ) : config ? (
          <>
            <p className="modal__hint">
              Current: <code>{config.workspace}</code>{" "}
              <span className="settings__source">(from {config.source})</span>
            </p>

            {envOverride && (
              <div className="settings__banner">
                <strong>BLUEPRINT_WORKSPACE</strong> is set in your shell to{" "}
                <code>{envOverride}</code> and overrides any UI setting.
                Unset it (e.g. <code>unset BLUEPRINT_WORKSPACE</code>) and
                restart <code>npm run dev</code> to use this dialog.
              </div>
            )}

            <label className="settings__label" htmlFor="settings-workspace">
              Workspace path
            </label>
            <input
              id="settings-workspace"
              className="settings__input"
              value={input}
              disabled={inputDisabled}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. ~/Documents/blueprints"
            />
            <p className="modal__hint">
              <code>~</code> expands to your home directory; relative paths
              resolve against the repo root. The directory will be created if
              it doesn't exist. Switching takes effect immediately — no
              dev-server restart needed.
            </p>

            {error && <div className="settings__error">{error}</div>}
          </>
        ) : (
          <p className="modal__hint">{error}</p>
        )}

        <div className="modal__actions">
          <button onClick={onReset} disabled={inputDisabled}>
            Reset to default
          </button>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={onSave}
            disabled={inputDisabled || !input.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
