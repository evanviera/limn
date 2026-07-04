import type { ReactNode } from "react";

export type IconName =
  | "archive"
  | "calendar"
  | "chat"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up-right"
  | "clipboard"
  | "copy"
  | "edit"
  | "folder"
  | "maximize"
  | "minus"
  | "moon"
  | "paperclip"
  | "plus"
  | "refresh"
  | "save"
  | "settings"
  | "sun"
  | "tag"
  | "trash"
  | "users"
  | "x";
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
export function LinkIcon() {
  return (
    <svg className="icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.9 5.03" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07l1.22-1.22" />
    </svg>
  );
}
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    archive: (
      <>
        <path d="M4 7h16" />
        <path d="M6 7v12h12V7" />
        <path d="M9 11h6" />
        <path d="M7 4h10l1 3H6z" />
      </>
    ),
    calendar: (
      <>
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 8h16" />
        <path d="M5 5h14v16H5z" />
      </>
    ),
    chat: (
      <>
        <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4z" />
        <path d="M8 8.5h8" />
        <path d="M8 11.5h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-left": <path d="m14 6-6 6 6 6" />,
    "chevron-right": <path d="m10 6 6 6-6 6" />,
    "chevron-up-right": (
      <>
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 4h6l1 2h3v15H5V6h3z" />
        <path d="M9 4v3h6V4" />
      </>
    ),
    copy: (
      <>
        <path d="M8 8h11v11H8z" />
        <path d="M5 16H4V5h11v1" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4l11-11-4-4L4 16z" />
        <path d="M13 7l4 4" />
      </>
    ),
    folder: (
      <>
        <path d="M3 6h7l2 2h9v10H3z" />
        <path d="M3 10h18" />
      </>
    ),
    maximize: <path d="M6 6h12v12H6z" />,
    minus: <path d="M5 12h14" />,
    moon: (
      <>
        <path d="M20 15.3A8 8 0 0 1 8.7 4a7 7 0 1 0 11.3 11.3z" />
      </>
    ),
    paperclip: (
      <path d="M20 11.5 11.7 19.8a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" />
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M18 9a6 6 0 0 0-10-3L4 10" />
        <path d="M6 15a6 6 0 0 0 10 3l4-4" />
      </>
    ),
    save: (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4" />
        <path d="M8 20v-6h8v6" />
      </>
    ),
    settings: (
      <>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m5.6 5.6 2.1 2.1" />
        <path d="m16.3 16.3 2.1 2.1" />
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="m18.4 5.6-2.1 2.1" />
        <path d="m7.7 16.3-2.1 2.1" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.9 4.9 1.4 1.4" />
        <path d="m17.7 17.7 1.4 1.4" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.9 19.1 1.4-1.4" />
        <path d="m17.7 6.3 1.4-1.4" />
      </>
    ),
    tag: (
      <>
        <path d="M4 12V5h7l9 9-7 7z" />
        <path d="M8.5 8.5h.01" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </>
    ),
    users: (
      <>
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
        <path d="M2 20a7 7 0 0 1 14 0" />
        <path d="M17 11a3 3 0 1 0 0-6" />
        <path d="M19 20a5 5 0 0 0-3-4.6" />
      </>
    ),
    x: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    )
  };

  return (
    <svg className="icon" aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
