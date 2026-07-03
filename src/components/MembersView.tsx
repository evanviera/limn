import { useRef, useState } from "react";
import type { Member } from "../types";
import { makeId } from "../storage";
import { memberColors } from "../lib/constants";
import { initials } from "../lib/format";
import { isEditableTextControl, textControlContextItems, type OpenContextMenu } from "./contextMenu";

export function MembersView({
  members,
  onSave,
  onRemove,
  onOpenContextMenu,
  onCopyText
}: {
  members: Member[];
  onSave: (member: Member) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [validation, setValidation] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  return (
    <section
      onContextMenu={(event) => {
        if (isEditableTextControl(event.target)) {
          onOpenContextMenu(event, textControlContextItems(event.target));
          return;
        }
        onOpenContextMenu(event, [
          { label: "Add member", icon: "plus", onSelect: () => nameInputRef.current?.focus() }
        ], "Members");
      }}
    >
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Members</h1>
        </div>
      </header>
      <form
        className="inline-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setValidation("Enter a member name.");
            return;
          }
          setValidation("");
          const member: Member = {
            id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || makeId("member"),
            name: name.trim(),
            color: memberColors[members.length % memberColors.length]
          };
          setName("");
          void onSave(member);
        }}
      >
        <input
          aria-describedby={validation ? "member-name-error" : undefined}
          aria-invalid={validation ? true : undefined}
          data-testid="member-name-input"
          ref={nameInputRef}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (validation) {
              setValidation("");
            }
          }}
          placeholder="Member name"
        />
        <button className="primary" data-testid="add-member">Add member</button>
        {validation && <p className="form-error" id="member-name-error">{validation}</p>}
      </form>
      <p className="muted">
        To @mention someone in Slack notifications, enter their Slack member ID
        (in Slack: open their profile → ⋮ → Copy member ID). A display name or
        handle won't ping them.
      </p>
      <div className="member-list">
        {members.length === 0 && <p className="muted">No members yet.</p>}
        {members.map((member) => (
          <div
            className="member-row"
            key={member.id}
            onContextMenu={(event) => {
              if (isEditableTextControl(event.target)) {
                onOpenContextMenu(event, textControlContextItems(event.target));
                return;
              }
              onOpenContextMenu(event, [
                { label: "Copy member name", icon: "copy", onSelect: () => void onCopyText(member.name) },
                {
                  label: "Copy Slack member ID",
                  icon: "copy",
                  disabled: !member.slackHandle?.trim(),
                  onSelect: () => void onCopyText(member.slackHandle ?? "")
                },
                { type: "separator" },
                { label: "Remove member", icon: "trash", danger: true, onSelect: () => void onRemove(member.id) }
              ], member.name);
            }}
          >
            <span className="avatar" style={{ background: member.color }}>
              {initials(member.name)}
            </span>
            <input
              value={member.name}
              onChange={(event) => void onSave({ ...member, name: event.target.value })}
              aria-label={`${member.name} name`}
            />
            <input
              data-testid={`member-${member.id}-slack-handle`}
              value={member.slackHandle ?? ""}
              onChange={(event) => void onSave({ ...member, slackHandle: event.target.value })}
              aria-label={`${member.name} Slack member ID`}
              placeholder="Slack member ID (U024BE7LH)"
            />
            <input
              type="color"
              value={member.color}
              onChange={(event) => void onSave({ ...member, color: event.target.value })}
              aria-label={`${member.name} color`}
            />
            <button onClick={() => void onRemove(member.id)}>Remove</button>
          </div>
        ))}
      </div>
    </section>
  );
}
