import { initials } from "../lib/format.js";

/**
 * A member's initials in a quiet neutral circle. Every avatar in the app goes
 * through here so they all look the same: no per-member color, one size scale.
 * The initials sit in their own span so text-box trimming (cap height to
 * baseline) applies and the letters center optically in WebKit and Chromium.
 */
export function Avatar({ name, small = false, title }: { name: string; small?: boolean; title?: string }) {
  return (
    <span className={small ? "avatar small" : "avatar"} title={title} aria-hidden={title ? undefined : true}>
      <span className="avatar-initials">{initials(name)}</span>
    </span>
  );
}
