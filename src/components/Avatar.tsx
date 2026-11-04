import type { CSSProperties } from "react";
import { initials } from "../lib/format.js";

/**
 * A member's initials in a circle. Every avatar in the app goes through here so
 * they all look the same. Pass the member's color: outside Quiet mode the
 * circle takes it (see accents.css); in Quiet mode every avatar is neutral grey.
 * The initials sit in their own span so text-box trimming (cap height to
 * baseline) applies and the letters center optically in WebKit and Chromium.
 */
export function Avatar({ name, color, small = false, title }: { name: string; color?: string; small?: boolean; title?: string }) {
  const style = color ? ({ "--member-color": color } as CSSProperties) : undefined;
  return (
    <span
      className={`avatar${small ? " small" : ""}${color ? " has-color" : ""}`}
      style={style}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      <span className="avatar-initials">{initials(name)}</span>
    </span>
  );
}
