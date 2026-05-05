import { useEffect, useRef, useState } from "react";

type Props = {
  notes: string;
  onChange: (next: string) => void;
};

// Lets the user edit notes. When the parent's `notes` prop changes (e.g. a
// remote update arrived), we sync into the textarea — but only if the user
// isn't actively typing. If they are, we hold the incoming change and apply
// it on blur, so we don't yank text out from under their cursor.
export function NotesPanel({ notes, onChange }: Props) {
  const [value, setValue] = useState(notes);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFocusedRef = useRef(false);
  const pendingExternalRef = useRef<string | null>(null);

  useEffect(() => {
    if (notes === value) return;
    if (isFocusedRef.current) {
      // Defer until the user is done.
      pendingExternalRef.current = notes;
    } else {
      setValue(notes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  return (
    <div className="notes">
      <textarea
        ref={textareaRef}
        className="notes__textarea"
        value={value}
        placeholder="Free-form notes for you and the agent. Save the document to commit."
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          const pending = pendingExternalRef.current;
          if (pending !== null) {
            pendingExternalRef.current = null;
            setValue(pending);
          }
        }}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          onChange(next);
        }}
      />
    </div>
  );
}
